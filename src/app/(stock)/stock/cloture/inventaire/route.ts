import { renderToBuffer } from "@react-pdf/renderer";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { TableauDocument } from "@/lib/pdf/tableau";
import { MOIS_FR } from "@/lib/dates-fr";
import { inventaireDuMois, parDomaine } from "@/lib/cloture-inventaire";

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `${r2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/**
 * Inventaire valorisé d'un mois (état figé à la clôture, sinon état actuel) : quantité et valeur
 * de chaque article, séparé en onglets Nourriture / Boissons / Autre, avec la valeur du stock total.
 */
export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "excel";
  const moisStr = sp.get("mois") ?? "";
  const m = moisStr.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return new Response("Mois invalide (attendu AAAA-M).", { status: 400 });
  const annee = Number(m[1]), mois = Number(m[2]);

  const inv = await inventaireDuMois(annee, mois);
  const groupes = parDomaine(inv);
  const periodeLabel = `${MOIS_FR[mois - 1]} ${annee}`;
  const etat = inv.fige ? "à la clôture" : "état actuel (mois non clôturé)";
  const sousTitre = `${periodeLabel} · ${etat} · stock total ${usd(inv.valeurTotaleUSD)}`;
  const suffixe = `${annee}-${String(mois).padStart(2, "0")}`;

  if (format === "excel") {
    const feuilles = groupes.map((g) => ({
      nom: g.label,
      titre: `Inventaire ${g.label} — ${periodeLabel} (${etat})`,
      entete: ["Article", "Quantité", "Prix U. USD", "Valeur USD"],
      lignes: g.lignes.map((l) => [l.designation, r2(l.quantite), r2(l.prixUnitaireUSD), r2(l.quantite * l.prixUnitaireUSD)]),
      totauxCols: [3],
    }));
    // Onglet de synthèse : valeur du stock total + par domaine.
    feuilles.unshift({
      nom: "Synthèse",
      titre: `Inventaire ${periodeLabel} — ${etat}`,
      entete: ["Domaine", "Articles", "Valeur USD"],
      lignes: [
        ...groupes.map((g) => [g.label, r2(g.lignes.length), g.valeur] as (string | number)[]),
      ],
      totauxCols: [2],
    });

    const buf = await classeurExcel({ titre: `Inventaire ${periodeLabel}`, periode: `Stock total ${usd(inv.valeurTotaleUSD)} · ${etat}`, feuilles });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Inventaire_${suffixe}.xlsx"`,
      },
    });
  }

  // PDF : sections par domaine (ligne-titre) + total général en dernière ligne.
  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  for (const g of groupes) {
    sectionRows.push(lignes.length);
    lignes.push([`${g.label} — ${usd(g.valeur)}`, "", "", ""]);
    for (const l of g.lignes) lignes.push([l.designation, r2(l.quantite), usd(l.prixUnitaireUSD), usd(l.quantite * l.prixUnitaireUSD)]);
  }
  lignes.push(["STOCK TOTAL", "", "", usd(inv.valeurTotaleUSD)]);

  const buf = await renderToBuffer(
    TableauDocument({
      titre: `Inventaire — ${periodeLabel}`,
      sousTitre,
      colonnes: [
        { header: "Article", width: "52%", align: "left" },
        { header: "Quantité", width: "16%", align: "right" },
        { header: "Prix U.", width: "16%", align: "right" },
        { header: "Valeur", width: "16%", align: "right" },
      ],
      lignes,
      sectionRows,
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
