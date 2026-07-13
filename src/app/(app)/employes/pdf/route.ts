import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { TableauDocument } from "@/lib/pdf/tableau";
import { filtrerEmployes, colonnesEmployes, ligneEmploye } from "../_donnees";

/** Export PDF de la liste des employés — mêmes colonnes et filtres que l'onglet. */
export async function GET(request: Request) {
  await verifySession();
  const sp = new URL(request.url).searchParams;

  const tous = await prisma.employee.findMany({ where: { actif: true }, orderBy: [{ categorie: "asc" }, { nom: "asc" }] });
  const employes = filtrerEmployes(tous, sp);
  const lignes = employes.map(ligneEmploye);

  const buffer = await renderToBuffer(
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
