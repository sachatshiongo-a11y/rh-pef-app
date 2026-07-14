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

/**
 * RATTRAPAGE : pose les codes manquants de TOUS les congés approuvés — couvre les congés validés
 * AVANT l'existence de la synchro à l'approbation (ils n'avaient jamais reçu leurs codes).
 * Idempotent et prudent : ne touche jamais un code déjà présent (createMany + skipDuplicates),
 * et n'écrit jamais dans un mois dont la paie est VALIDÉE (figée). Appelé au chargement de la
 * grille Présences ; au régime de croisière il ne fait plus rien.
 */
export async function rattraperCodesConges(): Promise<number> {
  const conges = await prisma.leaveRequest.findMany({ where: { statut: "APPROUVE" } });
  if (conges.length === 0) return 0;

  const runsValides = await prisma.payrollRun.findMany({
    where: { statut: "VALIDE" },
    select: { mois: true, annee: true },
  });
  const moisFiges = new Set(runsValides.map((r) => `${r.annee}-${r.mois}`));

  let total = 0;
  for (const c of conges) {
    const type = await prisma.typeConge.findUnique({ where: { nom: c.type }, select: { tauxPct: true } });
    const code: "C" | "S" = type?.tauxPct === 0 ? "S" : "C";
    const jours = await joursOuvrablesDuConge(new Date(c.dateDebut), new Date(c.dateFin));
    const eligibles = jours.filter((d) => !moisFiges.has(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`));
    if (eligibles.length === 0) continue;

    const existants = await prisma.attendance.findMany({
      where: { employeeId: c.employeeId, date: { in: eligibles } },
      select: { date: true },
    });
    const deja = new Set(existants.map((a) => iso(new Date(a.date))));
    const manquants = eligibles.filter((d) => !deja.has(iso(d)));
    if (manquants.length === 0) continue;

    await prisma.attendance.createMany({
      data: manquants.map((d) => ({ employeeId: c.employeeId, date: d, code })),
      skipDuplicates: true,
    });
    // Pas d'heures pendant un congé : retire les heures pré-remplies des jours rattrapés.
    await prisma.overtimeEntry.deleteMany({ where: { employeeId: c.employeeId, date: { in: manquants } } });
    total += manquants.length;
  }
  return total;
}

/** Retire les codes C/S de la plage (refus, suppression ou annulation d'un congé). Ne touche pas aux autres codes. */
export async function retirerCodesConge(employeeId: string, dateDebut: Date, dateFin: Date): Promise<number> {
  const { count } = await prisma.attendance.deleteMany({
    where: { employeeId, code: { in: ["C", "S"] }, date: { gte: new Date(dateDebut), lte: new Date(dateFin) } },
  });
  return count;
}
