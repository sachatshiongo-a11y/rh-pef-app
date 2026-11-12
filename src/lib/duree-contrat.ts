// DURÉE D'UN CDD À L'EMBAUCHE — module PUR (ni base, ni `server-only`), importable à l'écran.
// La fiche « Nouvel employé » saisit une durée en mois ; la date de fin du Contrat en découle
// (jour de fin INCLUS : un CDD de 6 mois commencé le 01/01 finit le 30/06). Le plafond légal est
// celui des Paramètres légaux (`cddDureeTotaleMaxMois`, lib/regles-contrats), passé par l'appelant.

/** Plafond de repli si l'appelant n'a pas chargé les règles (même valeur que REGLES_DEFAUT.cddDureeTotaleMaxMois). */
export const CDD_DUREE_MAX_MOIS_DEFAUT = 24;

/** Ce type de contrat porte une durée saisie à l'embauche. */
export const contratADuree = (contrat: unknown): boolean => contrat === "CDD";

/** Lit une durée en mois entière et positive (« 6 », « 6 mois ») ; null si vide ou illisible. */
export function lireDureeMois(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().replace(/\s*mois$/i, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Dernier jour (inclus) d'un contrat de `mois` mois commencé le `debut`. Date UTC « jour civil » ; null si début invalide. */
export function dateFinCdd(debut: Date | string, mois: number): Date | null {
  const d = debut instanceof Date ? debut : new Date(debut);
  if (Number.isNaN(d.getTime()) || !Number.isInteger(mois) || mois <= 0) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + mois, j = d.getUTCDate();
  const dernierJourCible = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // Le 31/01 + 1 mois n'existe pas : le contrat court jusqu'à la fin du mois cible. Sinon : veille de l'« anniversaire ».
  return j > dernierJourCible ? new Date(Date.UTC(y, m, dernierJourCible)) : new Date(Date.UTC(y, m, j - 1));
}

/** Contrôle de la durée d'un CDD : message lisible ou null. */
export function controlerDureeCdd(mois: unknown, maxMois: number = CDD_DUREE_MAX_MOIS_DEFAUT): string | null {
  const n = lireDureeMois(mois);
  if (n === null) return "La durée du CDD est obligatoire (nombre entier de mois).";
  if (n > maxMois) return `La durée du CDD ne peut pas dépasser ${maxMois} mois (Code du travail — paramètre modifiable dans les Barèmes). Pour une durée plus longue, choisissez un CDI.`;
  return null;
}
