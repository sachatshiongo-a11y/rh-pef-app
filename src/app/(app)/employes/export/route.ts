import { prisma } from "@/lib/prisma";
import { exigerEspaceRH } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { filtrerEmployes, colonnesEmployes, ligneEmploye, statutEmployes, whereStatutEmployes, libelleNombreEmployes } from "../_donnees";

/** Export Excel de la liste des employés — FIDÈLE à l'onglet (mêmes filtres, brigade puis backoffice). */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const sp = new URL(request.url).searchParams;

  const statut = statutEmployes(sp.get("statut")); // le statut de l'écran (actifs / inactifs / tous), pas toujours les actifs
  const tous = await prisma.employee.findMany({ where: whereStatutEmployes(statut), orderBy: [{ categorie: "asc" }, { nom: "asc" }] });
  const employes = filtrerEmployes(tous, sp);

  const lignes = employes.map(ligneEmploye);
  const buf = await classeurExcel({
    titre: "Liste des employés",
    periode: libelleNombreEmployes(employes.length, statut),
    feuilles: [{ nom: "Employés", entete: colonnesEmployes.map((c) => c.header), lignes }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Employes.xlsx"`,
    },
  });
}
