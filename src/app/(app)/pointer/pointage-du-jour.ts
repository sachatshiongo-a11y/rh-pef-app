import "server-only";
import { prisma } from "@/lib/prisma";
import { dateDuJourKinshasa } from "@/lib/pointage-jour";

// L'état du jour affiché par l'écran « Pointer » (espace RH et espace salarié) : un seul chargement
// pour les deux pages. « Aujourd'hui » = le jour de Kinshasa, comme les présences.

export type PointageDuJour = {
  nom: string | null;
  photoUrl: string | null;
  dateLabel: string;
  pointage: { heureDebut: string; heureFin: string | null; pauseMinutes: number } | null;
  /** Départ scanné dont la pause n'a pas encore été saisie (instant ISO), sinon null. */
  departScanne: string | null;
};

export async function chargerPointageDuJour(employeeId: string): Promise<PointageDuJour> {
  const date = dateDuJourKinshasa();
  const [emp, p] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true, photoUrl: true } }),
    prisma.pointage.findUnique({ where: { employeeId_date: { employeeId, date } } }),
  ]);
  const depart =
    p && !p.heureFin
      ? await prisma.scanPointage.findFirst({
          where: { pointageId: p.id, moment: "DEPART" },
          orderBy: { instant: "asc" },
          select: { instant: true },
        })
      : null;

  return {
    nom: emp?.nom ?? null,
    photoUrl: emp?.photoUrl ?? null,
    // `date` est minuit UTC du jour de Kinshasa : formatée en UTC, elle reste ce jour-là.
    dateLabel: date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    pointage: p
      ? { heureDebut: p.heureDebut.toISOString(), heureFin: p.heureFin ? p.heureFin.toISOString() : null, pauseMinutes: p.pauseMinutes }
      : null,
    departScanne: depart ? depart.instant.toISOString() : null,
  };
}
