import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { feuilleExcelComparaison } from "@/lib/journalier-comparaison-export";
import { donneesJournalier, roleCellule } from "../export-data";

const CMD = "FF1B7F3B", LIV = "FFB42318", CONSO = "FF3730A3"; // vert = commande, rouge = livraison, indigo = consommé

const ECART = "FFC2410C"; // orange = consommé en écart avec le livré (comparaison)
const COULEUR: Record<string, string | undefined> = { cmd: CMD, liv: LIV, conso: CONSO, ecart: ECART };

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;
  const d = await donneesJournalier(new URL(req.url).searchParams);

  // Comparaison : deux niveaux d'en-tête, jours séparés, écarts signés (voir `lib/journalier-comparaison-export`).
  const comparaison = d.ecartsCL && d.signes && d.enteteCourt && d.groupesEntete
    ? feuilleExcelComparaison({ ...d, lignes: d.lignes.map((l) => l.map(String)), ecarts: d.ecarts!, ecartsCL: d.ecartsCL, signes: d.signes, enteteCourt: d.enteteCourt, groupesEntete: d.groupesEntete })
    : null;
  const buf = await classeurExcel({
    titre: d.titre, periode: d.sousTitre,
    feuilles: [comparaison
      ? { nom: d.titre.slice(0, 28), ...comparaison }
      : {
          nom: d.titre.slice(0, 28), entete: d.entete, lignes: d.lignes, sectionRows: d.sectionRows,
          couleurTexteCellule: (r, c) => COULEUR[roleCellule(d, r, c) ?? ""],
        }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${d.fichierBase}.xlsx"`,
    },
  });
}
