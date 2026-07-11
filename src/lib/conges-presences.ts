import "server-only";
import { prisma } from "@/lib/prisma";

// Synchronisation congé → grille Présences : à l'APPROBATION d'un congé, les jours ouvrables
// couverts (jamais dimanche ni férié — même règle que le décompte) reçoivent automatiquement le
// code « C » (ou « S » si le type est à 0 % = sans solde) ; les heures pré-remplies de ces jours
// sont retirées (pas d'heures pendant un congé). Au refus/suppression, ces codes sont retirés.

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function joursOuvrablesDuConge(dateDebut: Date, dateFin: Date): Promise<Date[]> {
  const feries = await prisma.jourFerie.findMany({
    where: { date: { gte: dateDebut, lte: dateFin } },
    select: { date: true },
  });
  const feriesIso = new Set(feries.map((f) => iso(new Date(f.date))));
  const jours: Date[] = [];
  for (let d = new Date(dateDebut); d <= dateFin; d = new Date(d.getTime() + 86_400_000)) {
    if (d.getUTCDay() === 0 || feriesIso.has(iso(d))) continue;
    jours.push(new Date(d));
  }
  return jours;
}

/** Pose les codes de congé sur la grille Présences pour un congé approuvé. */
export async function poserCodesConge(employeeId: string, dateDebut: Date, dateFin: Date, typeNom: string): Promise<{ code: "C" | "S"; poses: number }> {
  const type = await prisma.typeConge.findUnique({ where: { nom: typeNom }, select: { tauxPct: true } });
  const code: "C" | "S" = type?.tauxPct === 0 ? "S" : "C";
  const jours = await joursOuvrablesDuConge(new Date(dateDebut), new Date(dateFin));
  for (const d of jours) {
    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: d } },
      update: { code },
      create: { employeeId, date: d, code },
    });
  }
  // Pas d'heures travaillées pendant un congé : retire les heures pré-remplies de la plage.
  if (jours.length > 0) {
    await prisma.overtimeEntry.deleteMany({ where: { employeeId, date: { in: jours } } });
  }
  return { code, poses: jours.length };
}

/** Retire les codes C/S de la plage (refus, suppression ou annulation d'un congé). Ne touche pas aux autres codes. */
export async function retirerCodesConge(employeeId: string, dateDebut: Date, dateFin: Date): Promise<number> {
  const { count } = await prisma.attendance.deleteMany({
    where: { employeeId, code: { in: ["C", "S"] }, date: { gte: new Date(dateDebut), lte: new Date(dateFin) } },
  });
  return count;
}
