import { renderPdfOuRefus } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceRH } from "@/lib/garde-route";
import { TableauDocument } from "@/lib/pdf/tableau";
import { filtrerEmployes, colonnesEmployes, ligneEmploye, statutEmployes, whereStatutEmployes, libelleNombreEmployes, refusSelectionTropGrande } from "../_donnees";

/** Export PDF de la liste des employés — mêmes colonnes et filtres que l'onglet. */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const sp = new URL(request.url).searchParams;
  const refus = refusSelectionTropGrande(sp);
  if (refus) return refus;

  const statut = statutEmployes(sp.get("statut")); // le statut de l'écran (actifs / inactifs / tous), pas toujours les actifs
  const tous = await prisma.employee.findMany({ where: whereStatutEmployes(statut), orderBy: [{ categorie: "asc" }, { nom: "asc" }] });
  const employes = filtrerEmployes(tous, sp);
  const lignes = employes.map(ligneEmploye);

  const buffer = await renderPdfOuRefus(() =>
    TableauDocument({
      titre: "Liste des employés",
      sousTitre: libelleNombreEmployes(employes.length, statut),
      colonnes: colonnesEmployes,
      lignes,
      paysage: true,
    }),
  );
  if (buffer instanceof Response) return buffer; // au-delà du plafond de lignes : 413 lisible, jamais tronqué
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Employes.pdf"` },
  });
}
