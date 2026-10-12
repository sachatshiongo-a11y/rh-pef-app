// FILTRE D'ÉTAT DES BONS DE COMMANDE (plan d'ergonomie, V3) — remplace la vue « Bons de commande
// validés » des Archives du Stock : le même écran filtre désormais par état (`?statut=VALIDE`).
//
// Module pur (ni base ni React) : lu par la page, par le formulaire et par les tests.

/** Les états filtrables, avec le libellé du filtre (pluriel : « Validés »). L'ordre est celui de la liste déroulante. */
export const FILTRE_STATUT_BON = {
  BROUILLON: "Brouillons",
  VALIDE: "Validés",
  ENVOYE: "Envoyés",
  RECU_PARTIEL: "Reçus partiellement",
  RECU: "Reçus",
  ANNULE: "Annulés",
} as const;

export type StatutBonFiltre = keyof typeof FILTRE_STATUT_BON;

/** L'état demandé dans l'adresse, ou `undefined` (tous les états) pour toute valeur inconnue. */
export function lireStatutBon(v: unknown): StatutBonFiltre | undefined {
  return typeof v === "string" && Object.hasOwn(FILTRE_STATUT_BON, v) ? (v as StatutBonFiltre) : undefined;
}
