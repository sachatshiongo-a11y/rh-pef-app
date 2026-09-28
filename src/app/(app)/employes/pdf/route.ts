import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceRH } from "@/lib/garde-route";
import { TableauDocument } from "@/lib/pdf/tableau";
import { filtrerEmployes, colonnesEmployes, ligneEmploye } from "../_donnees";

/** Export PDF de la liste des employés — mêmes colonnes et filtres que l'onglet. */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const sp = new URL(request.url).searchParams;

  const tous = await prisma.employee.findMany({ where: { actif: true }, orderBy: [{ categorie: "asc" }, { nom: "asc" }] });
  const employes = filtrerEmployes(tous, sp);
  const lignes = employes.map(ligneEmploye);

  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: "Liste des employés",
      sousTitre: `${employes.length} employé(s) actif(s)`,
      colonnes: colonnesEmployes,
      lignes,
      paysage: true,
    }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Employes.pdf"` },
  });
}
