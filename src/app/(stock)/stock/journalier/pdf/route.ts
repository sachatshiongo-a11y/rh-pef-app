import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { verifySession, requireModule } from "@/lib/auth";
import { TableauDocument } from "@/lib/pdf/tableau";
import { donneesJournalier, roleCellule } from "../export-data";

// Vert = commande, rouge = livraison (codes couleur de la fiche), indigo = consommé au restaurant.
const CMD = "#1B7F3B", LIV = "#B42318", CONSO = "#3730A3";
const COULEUR: Record<string, string | undefined> = { cmd: CMD, liv: LIV, conso: CONSO };

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");
  const d = await donneesJournalier(new URL(req.url).searchParams);
  const large = d.colonnes.length > 9;

  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: d.titre, sousTitre: d.sousTitre, colonnes: d.colonnes, lignes: d.lignes, sectionRows: d.sectionRows,
      paysage: large,
      couleurCellule: (r, c) => COULEUR[roleCellule(d, r, c) ?? ""],
      pied: "Vert = commande · rouge = livraison · indigo = consommé au restaurant (comptages ; « — » : jour sans comptage).",
    }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${d.fichierBase}.pdf"` },
  });
}
