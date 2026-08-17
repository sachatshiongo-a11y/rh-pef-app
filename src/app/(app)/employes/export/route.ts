import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { filtrerEmployes, colonnesEmployes, ligneEmploye } from "../_donnees";

/** Export Excel de la liste des employés — FIDÈLE à l'onglet (mêmes filtres, brigade puis backoffice). */
export async function GET(request: Request) {
  await verifySession();
  const sp = new URL(request.url).searchParams;

  const tous = await prisma.employee.findMany({ where: { actif: true }, orderBy: [{ categorie: "asc" }, { nom: "asc" }] });
  const employes = filtrerEmployes(tous, sp);

  const lignes = employes.map(ligneEmploye);
  const buf = await classeurExcel({
    titre: "Liste des employés",
    periode: `${employes.length} employé(s) actif(s)`,
    feuilles: [{ nom: "Employés", entete: colonnesEmployes.map((c) => c.header), lignes }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Employes.xlsx"`,
    },
  });
}
