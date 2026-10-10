// Règles de la clôture mensuelle du stock — module PUR (action, écran, tests).
//
// L'instantané de clôture est le stock du MOMENT où la Direction clôture : il ne peut pas être un
// « stock de fin de mois » reconstitué. Le seul moyen d'en approcher est de ne clôturer qu'un mois
// TERMINÉ : le mois en cours et les mois futurs sont refusés (audit du 10/10/2026, stock 14).

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libelle = (annee: number, mois: number) => `${MOIS_FR[mois - 1]} ${annee}`;

/** `moisCourant` : « AAAA-MM » (mois civil de Kinshasa). Lève une erreur lisible si le mois ne peut pas être clôturé. */
export function exigerMoisClorable(annee: number, mois: number, moisCourant: string): void {
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12 || annee < 2000 || annee > 2200) throw new Error("Période invalide.");
  const [ac, mc] = moisCourant.split("-").map(Number);
  const rang = annee * 12 + (mois - 1), rangCourant = ac * 12 + (mc - 1);
  if (rang > rangCourant) throw new Error(`${libelle(annee, mois)} n'a pas commencé : un mois futur ne se clôture pas.`);
  if (rang === rangCourant) throw new Error(`${libelle(annee, mois)} n'est pas terminé : le mois en cours ne se clôture pas (l'instantané figerait un stock incomplet). Clôturez-le à partir du 1er du mois suivant.`);
}

export const messageDejaCloture = (annee: number, mois: number) =>
  `${libelle(annee, mois)} est déjà clôturé : son instantané n'est pas réécrit. Rouvrez le mois d'abord (Rouvrir), puis clôturez-le de nouveau.`;
