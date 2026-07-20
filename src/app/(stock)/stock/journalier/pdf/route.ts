import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { verifySession, requireModule } from "@/lib/auth";
import { TableauDocument } from "@/lib/pdf/tableau";
import { donneesJournalier } from "../export-data";

// Vert = commande, rouge = livraison (codes couleur de la fiche).
const CMD = "#1B7F3B", LIV = "#B42318";

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");
  const d = await donneesJournalier(new URL(req.url).searchParams);
  const large = d.colonnes.length > 9;

  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: d.titre, sousTitre: d.sousTitre, colonnes: d.colonnes, lignes: d.lignes, sectionRows: d.sectionRows,
      paysage: large,
      couleurCellule: (_r, c) => (d.colRole[c] === "cmd" ? CMD : d.colRole[c] === "liv" ? LIV : undefined),
      pied: "Vert = commande · rouge = livraison.",
    }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${d.fichierBase}.pdf"` },
  });
}
