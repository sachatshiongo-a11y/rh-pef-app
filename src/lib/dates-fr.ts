// Helpers de dates partagés (avant : `lundiDe` copié dans 4 fichiers, tableaux de mois dans 13).
// Tout est en UTC : les dates métier (plannings, mouvements, semaines) sont des dates « pures ».

export const JOURS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MOIS_FR_MAJ = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
export const MOIS_FR_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Décale une valeur "AAAA-MM" (input type="month") de `delta` mois (UTC) — passage d'année géré
 *  par `Date.UTC` (un mois hors [0,11] se reporte tout seul sur l'année adjacente). */
export function moisAdjacent(moisValue: string, delta: number): string {
  const [a, m] = moisValue.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lundi (UTC) de la semaine contenant `d`. */
export function lundiDe(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/**
 * Groupe une liste (déjà triée) par mois → accordéons « Mois Année ». Conserve l'ordre d'entrée
 * (donc trier la liste par date décroissante avant d'appeler pour des mois du plus récent au plus ancien).
 */
export function grouperParMois<T>(items: T[], getDate: (t: T) => Date | string | null | undefined): { cle: string; titre: string; items: T[] }[] {
  const groupes: { cle: string; titre: string; items: T[] }[] = [];
  const idx = new Map<string, number>();
  for (const it of items) {
    const raw = getDate(it);
    const d = raw ? new Date(raw) : null;
    const cle = d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "sans-date";
    const titre = d ? `${MOIS_FR_MAJ[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "Sans date";
    if (!idx.has(cle)) { idx.set(cle, groupes.length); groupes.push({ cle, titre, items: [] }); }
    groupes[idx.get(cle)!].items.push(it);
  }
  return groupes;
}
