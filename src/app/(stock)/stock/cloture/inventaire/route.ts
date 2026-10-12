import { renderPdfOuRefus } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurInventaire, type FeuilleInventaire } from "@/lib/export-excel";
import { TableauDocument } from "@/lib/pdf/tableau";
import { MOIS_FR } from "@/lib/dates-fr";
import { inventaireDuMois, parDomaine, alerteLabel, ligneSansPrix } from "@/lib/cloture-inventaire";
import { mentionSansPrix } from "@/lib/valeur-stock";
import { dateHeureGenerationKinshasa } from "@/lib/heure-kinshasa";
import { niveauAlerte, uniteAffichee } from "@/lib/stock";
import { formaterNombre } from "@/lib/montant";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `${formaterNombre(r2(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const num = (n: number) => formaterNombre(Math.round(n * 1000) / 1000);

/**
 * Inventaire valorisé d'un mois (figé à la clôture, sinon état actuel) : une feuille par domaine
 * avec KPI en haut, tableau d'inventaire (catégorie, fournisseur, statut de réappro) ET les
 * mouvements du même domaine dans la même feuille. Excel riche, PDF récapitulatif.
 */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "excel";
  const m = (sp.get("mois") ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return new Response("Mois invalide (attendu AAAA-M).", { status: 400 });
  const annee = Number(m[1]), mois = Number(m[2]);

  const inv = await inventaireDuMois(annee, mois);
  const groupes = parDomaine(inv);
  const periodeLabel = `${MOIS_FR[mois - 1]} ${annee}`;
  // Honnête sur la date : l'instantané est le stock du MOMENT de la clôture, pas un stock de fin de mois reconstitué.
  const etat = inv.fige
    ? `stock figé à la clôture : stock au ${inv.figeLe ? dateHeureGenerationKinshasa(inv.figeLe) : "moment de la clôture (heure non conservée)"}`
    : `état actuel au ${dateHeureGenerationKinshasa(new Date())} (mois non clôturé)`;
  // Total partiel : les articles en stock sans prix n'y sont pas comptés (jamais 0 en silence).
  const partiel = mentionSansPrix(inv.nbSansPrix);
  const totalTexte = `${usd(inv.valeurTotaleUSD)}${partiel ? ` (${partiel})` : ""}`;
  const suffixe = `${annee}-${String(mois).padStart(2, "0")}`;

  // Mouvements du mois, groupés par domaine (dans la feuille du domaine, jamais à part).
  const debut = new Date(Date.UTC(annee, mois - 1, 1)), fin = new Date(Date.UTC(annee, mois, 1));
  const mouvements = await prisma.mouvementStock.findMany({
    where: { date: { gte: debut, lt: fin } },
    orderBy: [{ date: "asc" }],
    take: 8000,
    include: { article: { select: { code: true, ...CHAMPS_LIBELLE, unite: true, domaine: true } } },
  });
  const mvtParDomaine = (dom: string) => mouvements.filter((x) => String(x.article.domaine) === dom);

  if (format === "excel") {
    const feuilles: FeuilleInventaire[] = groupes.map((g) => {
      const urgents = g.lignes.filter((l) => niveauAlerte(l.quantite, l.stockMinimum, l.seuilUrgent) === "URGENT").length;
      const appros = g.lignes.filter((l) => niveauAlerte(l.quantite, l.stockMinimum, l.seuilUrgent) === "APPRO").length;
      const mvts = mvtParDomaine(g.domaine);
      const valEnt = r2(mvts.filter((x) => x.type !== "SORTIE").reduce((t, x) => t + (x.montantUSD !== null ? Number(x.montantUSD) : 0), 0));
      const valSor = r2(mvts.filter((x) => x.type === "SORTIE").reduce((t, x) => t + (x.montantUSD !== null ? Number(x.montantUSD) : 0), 0));
      return {
        nom: g.label,
        titre: `Inventaire ${g.label} — ${periodeLabel} (${etat})`,
        kpis: [
          { label: `Valeur du stock — ${g.label}`, valeur: `${usd(g.valeur)}${g.nbSansPrix > 0 ? ` (${mentionSansPrix(g.nbSansPrix)})` : ""}` },
          { label: "Valeur du stock — TOTAL", valeur: totalTexte },
          { label: "Articles", valeur: String(g.lignes.length) },
          { label: "Dont à réapprovisionner", valeur: String(urgents + appros) },
          { label: "En rupture (urgent)", valeur: String(urgents) },
          { label: "À réapprovisionner", valeur: String(appros) },
          { label: "Entrées du mois (USD)", valeur: usd(valEnt) },
          { label: "Sorties du mois (USD)", valeur: usd(valSor) },
        ],
        invEntete: ["Code", "Désignation", "Unité", "Catégorie", "Fournisseur", "Stock min", "Stock final", "Alerte stock", "Prix U. USD", "Valeur USD", "Prix saisi en FC"],
        invLignes: g.lignes.map((l) => [
          l.code, libelleArticle(l), l.unite, l.categorie, l.fournisseur,
          r2(l.stockMinimum), r2(l.quantite), alerteLabel(l.quantite, l.stockMinimum, l.seuilUrgent),
          // Sans prix : cellules vides (jamais 0) — le total est partiel de ces articles.
          ligneSansPrix(l) ? "" : r2(l.prixUnitaireUSD), ligneSansPrix(l) ? "" : r2(l.quantite * l.prixUnitaireUSD),
          // Article en francs : son prix tel que saisi et le taux qui l'a converti (« taux non défini » : non valorisé).
          l.prixUnitaireCDF !== undefined ? `${l.prixUnitaireCDF} FC ${l.tauxChange ? `≈ au taux ${l.tauxChange}` : "(taux non défini : non valorisé)"}` : ligneSansPrix(l) ? "sans prix" : "",
        ]),
        invTotauxCols: [9],
        alerteCol: 7,
        mvtTitre: `MOUVEMENTS DU MOIS — ${g.label}`,
        // Unité de l'article à côté des quantités (2026-10-09) ; « — » si elle manque, jamais devinée.
        mvtEntete: ["Date", "Code", "Désignation", "Unité", "Entrées", "Sorties", "Valeur USD"],
        mvtLignes: mvts.map((x) => [
          new Date(x.date).toLocaleDateString("fr-FR"),
          x.article.code ?? "",
          libelleArticle(x.article),
          uniteAffichee(x.article.unite),
          x.type !== "SORTIE" ? num(Number(x.quantite)) : "",
          x.type === "SORTIE" ? num(Number(x.quantite)) : "",
          x.montantUSD !== null ? r2(Number(x.montantUSD)) : "",
        ]),
      };
    });

    const buf = await classeurInventaire({ periode: `${periodeLabel} · ${etat} · stock total ${totalTexte}`, feuilles });
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
    lignes.push([`${g.label} — ${usd(g.valeur)}${g.nbSansPrix > 0 ? ` (${mentionSansPrix(g.nbSansPrix)})` : ""}`, "", "", "", "", ""]); couleurs.push(undefined);
    for (const l of g.lignes) {
      lignes.push([libelleArticle(l), l.categorie, l.fournisseur, alerteLabel(l.quantite, l.stockMinimum, l.seuilUrgent), num(l.quantite), ligneSansPrix(l) ? "—" : l.prixUnitaireCDF !== undefined ? (l.tauxChange ? `≈ ${usd(l.quantite * l.prixUnitaireUSD)}` : "—") : usd(l.quantite * l.prixUnitaireUSD)]);
      couleurs.push(COULEUR[niveauAlerte(l.quantite, l.stockMinimum, l.seuilUrgent)]);
    }
  }
  lignes.push([`STOCK TOTAL${partiel ? ` (${partiel})` : ""}`, "", "", "", "", usd(inv.valeurTotaleUSD)]); couleurs.push(undefined);

  const buf = await renderPdfOuRefus(() =>
    TableauDocument({
      titre: `Inventaire — ${periodeLabel}`,
      sousTitre: `${etat} · stock total ${totalTexte}`,
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
    if (buf instanceof Response) return buf; // au-delà du plafond de lignes : 413 lisible, jamais tronqué
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Inventaire_${suffixe}.pdf"`,
    },
  });
}
