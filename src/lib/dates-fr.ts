// Helpers de dates partagés (avant : `lundiDe` copié dans 4 fichiers, tableaux de mois dans 13).
// Tout est en UTC : les dates métier (plannings, mouvements, semaines) sont des dates « pures ».
// Seule exception, nommée « Kinshasa » : le « maintenant » (mois / lundi courants), qui passe par
// `heure-kinshasa.ts` — l'horloge du serveur est en UTC, le jour civil des données est celui de
// Kinshasa (UTC+1).

import { jourCivilKinshasa, moisCourantKinshasa } from "@/lib/heure-kinshasa";

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

/** Mois civil (UTC) de `d` au format "AAAA-MM" — la valeur d'un input type="month". `d` est une date
 *  PURE (minuit UTC d'un jour civil, comme les dates stockées) ; pour le mois COURANT, déduit de
 *  l'horloge, utiliser `moisCourantKinshasa(new Date())`. */
export function moisDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lit `?mois=AAAA-MM` : valeur normalisée "AAAA-MM" si le mois est valide (01 à 12), sinon le
 *  mois civil de Kinshasa de `maintenant` (l'instant présent). Un mois futur est accepté (même règle que l'Exploitation). */
export function moisDuParametre(param: string | undefined, maintenant: Date): string {
  const m = typeof param === "string" ? /^(\d{4})-(\d{1,2})$/.exec(param) : null;
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;
  return moisCourantKinshasa(maintenant);
}

/** Lundi (UTC) de la semaine contenant `d`. */
export function lundiDe(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Lundi de la semaine EN COURS à Kinshasa (date pure, minuit UTC) — `lundiDe` de « maintenant »
 *  lu à l'heure de Kinshasa : entre dimanche 23 h et minuit UTC, la semaine a déjà changé. */
export function lundiCourantKinshasa(maintenant: Date = new Date()): Date {
  return lundiDe(jourCivilKinshasa(maintenant));
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

const LUNDI_REF = Date.UTC(1970, 0, 5); // 5 janvier 1970 = un lundi

/** Parité de la semaine d'une date : 1 = semaine A, 2 = semaine B (pour les modèles bi-hebdo). */
export function pariteSemaine(d: Date): 1 | 2 {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); // lundi de la semaine
  const semaines = Math.floor((date.getTime() - LUNDI_REF) / (7 * 86_400_000));
  return semaines % 2 === 0 ? 1 : 2;
}
