import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Jours couverts par un congé APPROUVÉ, pour un lot (employé, date) donné.
 * Renvoie un Set de clés `employeeId|AAAA-MM-JJ` — utilisé par les saisies automatiques
 * (présences / heures en lot) pour ne pas marquer présent ou compter des heures pendant un congé.
 */
export async function joursEnConge(entrees: { employeeId: string; date: string }[]): Promise<Set<string>> {
  if (entrees.length === 0) return new Set();
  const employeeIds = [...new Set(entrees.map((e) => e.employeeId))];
  const dates = entrees.map((e) => e.date).sort();
  const min = new Date(`${dates[0]}T00:00:00.000Z`);
  const max = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`);

  const conges = await prisma.leaveRequest.findMany({
    where: { statut: "APPROUVE", employeeId: { in: employeeIds }, dateDebut: { lte: max }, dateFin: { gte: min } },
    select: { employeeId: true, dateDebut: true, dateFin: true },
  });

  const couverts = new Set<string>();
  for (const e of entrees) {
    const d = new Date(`${e.date}T00:00:00.000Z`);
    if (conges.some((c) => c.employeeId === e.employeeId && d >= new Date(c.dateDebut) && d <= new Date(c.dateFin))) {
      couverts.add(`${e.employeeId}|${e.date}`);
    }
  }
  return couverts;
}
