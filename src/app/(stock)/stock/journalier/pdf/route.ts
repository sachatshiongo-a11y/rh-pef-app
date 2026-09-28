import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { exigerEspaceStock } from "@/lib/garde-route";
import { TableauDocument, TableauxParPartieDocument } from "@/lib/pdf/tableau";
import { donneesJournalier, roleCellule } from "../export-data";

// Vert = commande, rouge = livraison (codes couleur de la fiche), indigo = consommé au restaurant.
const CMD = "#1B7F3B", LIV = "#B42318", CONSO = "#3730A3";
const ECART = "#C2410C"; // orange = consommé en écart avec le livré (comparaison)
const COULEUR: Record<string, string | undefined> = { cmd: CMD, liv: LIV, conso: CONSO, ecart: ECART };

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;
  const d = await donneesJournalier(new URL(req.url).searchParams);
  const large = d.colonnes.length > 9;

  const pied = "Vert = commande · rouge = livraison · indigo = consommé au restaurant (comptages ; « — » : jour sans comptage) · orange = consommé ≠ livré.";
  const buffer = await renderPdfBuffer(
    d.partiesPdf
      ? TableauxParPartieDocument({
          titre: d.titre, sousTitre: d.sousTitre, paysage: true, pied,
          parties: d.partiesPdf.map((p) => ({
            titre: p.titre, colonnes: p.colonnes, sectionRows: d.sectionRows,
            lignes: d.lignes.map((l) => p.indices.map((i) => l[i] ?? "")),
            couleurCellule: (r, c) => COULEUR[roleCellule(d, r, p.indices[c]!) ?? ""],
          })),
        })
      : TableauDocument({
          titre: d.titre, sousTitre: d.sousTitre, colonnes: d.colonnes, lignes: d.lignes, sectionRows: d.sectionRows,
          paysage: large,
          couleurCellule: (r, c) => COULEUR[roleCellule(d, r, c) ?? ""],
          pied,
        }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${d.fichierBase}.pdf"` },
  });
}
