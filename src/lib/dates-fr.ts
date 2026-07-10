// Helpers de dates partagés (avant : `lundiDe` copié dans 4 fichiers, tableaux de mois dans 13).
// Tout est en UTC : les dates métier (plannings, mouvements, semaines) sont des dates « pures ».

export const JOURS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MOIS_FR_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Lundi (UTC) de la semaine contenant `d`. */
export function lundiDe(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
