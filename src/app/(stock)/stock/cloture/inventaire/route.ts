import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurInventaire, type FeuilleInventaire } from "@/lib/export-excel";
import { TableauDocument } from "@/lib/pdf/tableau";
import { MOIS_FR } from "@/lib/dates-fr";
import { inventaireDuMois, parDomaine, alerteLabel } from "@/lib/cloture-inventaire";
import { niveauAlerte } from "@/lib/stock";

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `${r2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const num = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("fr-FR");

/**
 * Inventaire valorisé d'un mois (figé à la clôture, sinon état actuel) : une feuille par domaine
 * avec KPI en haut, tableau d'inventaire (catégorie, fournisseur, statut de réappro) ET les
 * mouvements du même domaine dans la même feuille. Excel riche, PDF récapitulatif.
 */
export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "excel";
  const m = (sp.get("mois") ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return new Response("Mois invalide (attendu AAAA-M).", { status: 400 });
  const annee = Number(m[1]), mois = Number(m[2]);

  const inv = await inventaireDuMois(annee, mois);
  const groupes = parDomaine(inv);
  const periodeLabel = `${MOIS_FR[mois - 1]} ${annee}`;
  const etat = inv.fige ? "à la clôture" : "état actuel (mois non clôturé)";
  const suffixe = `${annee}-${String(mois).padStart(2, "0")}`;

  // Mouvements du mois, groupés par domaine (dans la feuille du domaine, jamais à part).
  const debut = new Date(Date.UTC(annee, mois - 1, 1)), fin = new Date(Date.UTC(annee, mois, 1));
  const mouvements = await prisma.mouvementStock.findMany({
    where: { date: { gte: debut, lt: fin } },
    orderBy: [{ date: "asc" }],
    take: 8000,
    include: { article: { select: { code: true, designation: true, domaine: true } } },
  });
  const mvtParDomaine = (dom: string) => mouvements.filter((x) => String(x.article.domaine) === dom);

  if (format === "excel") {
    const feuilles: FeuilleInventaire[] = groupes.map((g) => {
      const urgents = g.lignes.filter((l) => niveauAlerte(l.quantite, l.stockMinimum) === "URGENT").length;
      const appros = g.lignes.filter((l) => niveauAlerte(l.quantite, l.stockMinimum) === "APPRO").length;
      const mvts = mvtParDomaine(g.domaine);
      const valEnt = r2(mvts.filter((x) => x.type !== "SORTIE").reduce((t, x) => t + (x.montantUSD !== null ? Number(x.montantUSD) : 0), 0));
      const valSor = r2(mvts.filter((x) => x.type === "SORTIE").reduce((t, x) => t + (x.montantUSD !== null ? Number(x.montantUSD) : 0), 0));
      return {
        nom: g.label,
        titre: `Inventaire ${g.label} — ${periodeLabel} (${etat})`,
        kpis: [
          { label: `Valeur du stock — ${g.label}`, valeur: usd(g.valeur) },
          { label: "Valeur du stock — TOTAL", valeur: usd(inv.valeurTotaleUSD) },
          { label: "Articles", valeur: String(g.lignes.length) },
          { label: "Dont à réapprovisionner", valeur: String(urgents + appros) },
          { label: "En rupture (urgent)", valeur: String(urgents) },
          { label: "À réapprovisionner", valeur: String(appros) },
          { label: "Entrées du mois (USD)", valeur: usd(valEnt) },
          { label: "Sorties du mois (USD)", valeur: usd(valSor) },
        ],
        invEntete: ["Code", "Désignation", "Unité", "Catégorie", "Fournisseur", "Stock min", "Stock final", "Alerte stock", "Prix U. USD", "Valeur USD"],
        invLignes: g.lignes.map((l) => [
          l.code, l.designation, l.unite, l.categorie, l.fournisseur,
          r2(l.stockMinimum), r2(l.quantite), alerteLabel(l.quantite, l.stockMinimum),
          r2(l.prixUnitaireUSD), r2(l.quantite * l.prixUnitaireUSD),
        ]),
        invTotauxCols: [9],
        alerteCol: 7,
        mvtTitre: `MOUVEMENTS DU MOIS — ${g.label}`,
        mvtEntete: ["Date", "Code", "Désignation", "Entrées", "Sorties", "Valeur USD"],
        mvtLignes: mvts.map((x) => [
          new Date(x.date).toLocaleDateString("fr-FR"),
          x.article.code ?? "",
          x.article.designation,
          x.type !== "SORTIE" ? num(Number(x.quantite)) : "",
          x.type === "SORTIE" ? num(Number(x.quantite)) : "",
          x.montantUSD !== null ? r2(Number(x.montantUSD)) : "",
        ]),
      };
    });

    const buf = await classeurInventaire({ periode: `${periodeLabel} · ${etat} · stock total ${usd(inv.valeurTotaleUSD)}`, feuilles });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Inventaire_${suffixe}.xlsx"`,
      },
    });
  }

  // PDF : sections par domaine (ligne-titre) + total général en dernière ligne, colonnes enrichies.
  // Chaque ligne article est colorée selon son statut de réapprovisionnement.
  const COULEUR: Record<string, string> = { URGENT: "#F8D2D5", APPRO: "#FBE7C6", OK: "#D6EFDB" };
  const lignes: (string | number)[][] = [];
  const couleurs: (string | undefined)[] = [];
  const sectionRows: number[] = [];
  for (const g of groupes) {
    sectionRows.push(lignes.length);
    lignes.push([`${g.label} — ${usd(g.valeur)}`, "", "", "", "", ""]); couleurs.push(undefined);
    for (const l of g.lignes) {
      lignes.push([l.designation, l.categorie, l.fournisseur, alerteLabel(l.quantite, l.stockMinimum), num(l.quantite), usd(l.quantite * l.prixUnitaireUSD)]);
      couleurs.push(COULEUR[niveauAlerte(l.quantite, l.stockMinimum)]);
    }
  }
  lignes.push(["STOCK TOTAL", "", "", "", "", usd(inv.valeurTotaleUSD)]); couleurs.push(undefined);

  const buf = await renderToBuffer(
    TableauDocument({
      titre: `Inventaire — ${periodeLabel}`,
      sousTitre: `${etat} · stock total ${usd(inv.valeurTotaleUSD)}`,
      colonnes: [
        { header: "Désignation", width: "30%", align: "left" },
        { header: "Catégorie", width: "20%", align: "left" },
        { header: "Fournisseur", width: "16%", align: "left" },
        { header: "Alerte", width: "14%", align: "left" },
        { header: "Qté", width: "8%", align: "right" },
        { header: "Valeur", width: "12%", align: "right" },
      ],
      lignes,
      sectionRows,
      couleurLigne: (r) => couleurs[r],
      totalDerniereLigne: true,
    }),
  );
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Inventaire_${suffixe}.pdf"`,
    },
  });
}
