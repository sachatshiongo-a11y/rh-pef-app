import { finApresJoursOuvrables } from "@/lib/jours-ouvrables";

/**
 * Date de reprise après un congé : le PREMIER JOUR OUVRABLE qui suit la date de fin (ni dimanche ni
 * jour férié, même règle que le décompte des jours — `lib/jours-ouvrables.ts`). Un congé qui finit
 * un samedi reprend le lundi, jamais le dimanche. Dates en UTC à minuit (colonnes `@db.Date`).
 */
export function dateRepriseConge(dateFin: Date, joursFeries: Iterable<Date | string> = []): Date {
  const lendemain = new Date(dateFin);
  lendemain.setUTCDate(lendemain.getUTCDate() + 1);
  // Un seul jour ouvrable à compter : « la fin pour 1 jour » est le premier jour ouvrable à partir du lendemain.
  return finApresJoursOuvrables(lendemain, 1, joursFeries) ?? lendemain;
}
