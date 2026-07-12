import { verifySession } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { donneesPlanning } from "../export-data";

/** Planning (semaine ou mois) en Excel : employés × jours, groupé Brigade/Backoffice. */
export async function GET(req: Request) {
  await verifySession();
  const { titre, sousTitre, fichierBase, labels, lignes, sectionRows } = await donneesPlanning(new URL(req.url).searchParams);

  const buf = await classeurExcel({
    titre,
    periode: sousTitre,
    feuilles: [{ nom: "Planning", entete: ["Employé", ...labels], lignes, sectionRows }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fichierBase}.xlsx"`,
    },
  });
}
