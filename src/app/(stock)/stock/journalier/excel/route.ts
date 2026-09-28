import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { donneesJournalier, roleCellule } from "../export-data";

const CMD = "FF1B7F3B", LIV = "FFB42318", CONSO = "FF3730A3"; // vert = commande, rouge = livraison, indigo = consommé

const ECART = "FFC2410C"; // orange = consommé en écart avec le livré (comparaison)
const COULEUR: Record<string, string | undefined> = { cmd: CMD, liv: LIV, conso: CONSO, ecart: ECART };

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");
  const d = await donneesJournalier(new URL(req.url).searchParams);

  const buf = await classeurExcel({
    titre: d.titre, periode: d.sousTitre,
    feuilles: [{
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
