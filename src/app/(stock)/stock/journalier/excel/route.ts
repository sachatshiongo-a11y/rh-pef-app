import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { donneesJournalier } from "../export-data";

const CMD = "FF1B7F3B", LIV = "FFB42318"; // vert = commande, rouge = livraison

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");
  const d = await donneesJournalier(new URL(req.url).searchParams);

  const buf = await classeurExcel({
    titre: d.titre, periode: d.sousTitre,
    feuilles: [{
      nom: d.titre.slice(0, 28), entete: d.entete, lignes: d.lignes, sectionRows: d.sectionRows,
      couleurTexteCellule: (_r, c) => (d.colRole[c] === "cmd" ? CMD : d.colRole[c] === "liv" ? LIV : undefined),
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${d.fichierBase}.xlsx"`,
    },
  });
}
