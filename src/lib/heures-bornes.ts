// BORNES SERVEUR DES HEURES D'UNE JOURNÉE (audit 2026-10-10, relevé par la paie) : une heure écrite
// aux présences est un nombre fini entre 0 et 24. Le serveur revérifie (l'écran ne fait pas foi) et
// un LOT qui en contient une seule hors bornes est refusé EN ENTIER, avant la première écriture.
// Module pur.

export const HEURES_MIN = 0;
export const HEURES_MAX = 24;

/** Vrai si `h` est un nombre d'heures acceptable pour une journée (0 à 24, ni négatif, ni NaN). */
export function heuresDansLesBornes(h: unknown): h is number {
  return typeof h === "number" && Number.isFinite(h) && h >= HEURES_MIN && h <= HEURES_MAX;
}

/** Message de refus d'un lot : combien de valeurs, et la première, avec son jour. */
export function messageHeuresHorsBornes(fautives: { date: string; heures: unknown }[]): string {
  const p = fautives[0];
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(p?.date ?? "") ? p.date.split("-").reverse().join("/") : "jour illisible";
  return `${fautives.length} valeur(s) d'heures hors bornes (0 à 24 h attendus), ex. « ${String(p?.heures)} » le ${jour}. Rien n'a été enregistré.`;
}
