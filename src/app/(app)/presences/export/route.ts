import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { resumerPresences, type CodePresence } from "@/lib/payroll";
import { classeurExcel } from "@/lib/export-excel";

/**
 * Export Excel des présences du mois courant — FIDÈLE à l'onglet Présences : mêmes colonnes
 * (codes par jour) et mêmes totaux (Payé 100% / Payé 2·3 / Non payé / Total présences), même
 * ordre (brigade puis backoffice, par nom). Les heures supp. ont leur propre export dédié.
 */
export async function GET() {
  await verifySession();

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;
  const nbJours = new Date(annee, mois, 0).getDate();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [employees, attendances] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
    }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
  ]);

  const codeMap = new Map<string, string>();
  const codesParEmp: Record<string, CodePresence[]> = {};
  for (const a of attendances) {
    const jour = new Date(a.date).getUTCDate();
    codeMap.set(`${a.employeeId}_${jour}`, a.code);
    (codesParEmp[a.employeeId] ??= []).push(a.code as CodePresence);
  }

  const entetes = [
    "Matricule",
    "Nom",
    "Catégorie",
    ...Array.from({ length: nbJours }, (_, i) => String(i + 1)),
    "Payé 100%",
    "Payé 2/3",
    "Non payé",
    "Total prés.",
  ];

  const lignes = employees.map((e) => {
    const r = resumerPresences(codesParEmp[e.id] ?? []);
    const jours = Array.from({ length: nbJours }, (_, i) => codeMap.get(`${e.id}_${i + 1}`) ?? "");
    return [e.matricule, e.nom, e.categorie, ...jours, r.payes100, r.payes2_3, r.nonPayes, r.totalPresence];
  });

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const buf = await classeurExcel({
    titre: "Présences",
    periode,
    feuilles: [{ nom: "Présences", entete: entetes, lignes }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Presences_${annee}-${String(mois).padStart(2, "0")}.xlsx"`,
    },
  });
}
