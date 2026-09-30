// Fonctions PURES de la vue « un jour à la fois » du téléphone (sélecteur de jour, titres de liste).
// Dates pures AAAA-MM-JJ, calculées en UTC : aucun fuseau, aucune surprise à minuit.

/** Jour de la semaine, lundi = 0. */
export const rangDansSemaine = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

/** « mercredi 30 septembre » — libellé complet d'un jour, pour les titres et les lecteurs d'écran. */
export const libelleJourLong = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Rang du jour proposé à l'ouverture : aujourd'hui s'il est dans la semaine affichée, sinon le premier jour. */
export function rangJourParDefaut(isos: string[], aujourdhui: string): number {
  const i = isos.indexOf(aujourdhui);
  return i >= 0 ? i : 0;
}
