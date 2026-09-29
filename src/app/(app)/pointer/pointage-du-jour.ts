import "server-only";
import { prisma } from "@/lib/prisma";
import { dateDuJourKinshasa, heuresPayables, pauseDuJour, type PauseDuJour } from "@/lib/pointage-jour";
import { POINTAGE_VALABLE, SCAN_VALABLE } from "@/lib/pointage-annulation";

// L'état du jour affiché par l'écran « Pointer » (espace RH et espace salarié) : un seul chargement
// pour les deux pages. « Aujourd'hui » = le jour de Kinshasa, comme les présences.
// Un pointage dont l'arrivée a été annulée (« Annuler ce pointage ») n'existe pas ici ; un scan
// annulé ne compte pas (rien n'est effacé en base : cf. lib/pointage-annulation).

export type PointageDuJour = {
  nom: string | null;
  photoUrl: string | null;
  dateLabel: string;
  /**
   * `heures` = heures PAYABLES de la journée close (`heuresPayables` : la pause par défaut n'est pas
   * déduite), calculées ICI, côté serveur — l'écran ne refait aucun calcul d'heures. null si ouverte.
   */
  pointage: { heureDebut: string; heureFin: string | null; pause: PauseDuJour; heures: number | null } | null;
  /** Départ scanné AVANT la clôture automatique, jamais clos (instant ISO), sinon null. */
  departScanne: string | null;
};

export async function chargerPointageDuJour(employeeId: string): Promise<PointageDuJour> {
  const date = dateDuJourKinshasa();
  const [emp, p] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true, photoUrl: true } }),
    prisma.pointage.findFirst({ where: { AND: [{ employeeId, date }, POINTAGE_VALABLE] } }),
  ]);
  const depart =
    p && !p.heureFin
      ? await prisma.scanPointage.findFirst({
          where: { pointageId: p.id, moment: "DEPART", ...SCAN_VALABLE },
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
      ? {
          heureDebut: p.heureDebut.toISOString(),
          heureFin: p.heureFin ? p.heureFin.toISOString() : null,
          pause: pauseDuJour(p),
          heures: p.heureFin ? heuresPayables({ ...p, heureFin: p.heureFin }) : null,
        }
      : null,
    departScanne: depart ? depart.instant.toISOString() : null,
  };
}
