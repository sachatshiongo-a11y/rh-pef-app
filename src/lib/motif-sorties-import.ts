// MOTIF DES SORTIES IMPORTÉES — module pur (écran d'import, actions, moteurs d'import).
//
// Décision de la Direction (2026-09-28) : les imports Excel/CSV ne posaient jamais de motif sur
// les sorties (1 093 sorties sur 1 107 sans motif). Désormais, une sortie importée reçoit par
// défaut le motif « Livraison restaurant » ; l'écran d'import propose une case, cochée par
// défaut, pour ne poser aucun motif. Les sorties déjà en base ne sont JAMAIS requalifiées ici.

export const MOTIF_LIVRAISON_RESTAURANT = "LIVRAISON_RESTAURANT" as const;

/** Nom du champ envoyé par l'écran d'import : « 1 » = livraisons (défaut), « 0 » = sans motif. */
export const CHAMP_SORTIES_LIVRAISON = "sortiesLivraison";

/**
 * Lit le choix de l'écran. Absent → OUI : c'est le défaut voulu. L'écran envoie donc TOUJOURS
 * « 1 » ou « 0 » explicitement (une case décochée n'est pas envoyée par un formulaire HTML :
 * la lire telle quelle ferait du décochage un « oui »).
 */
export function sortiesSontLivraisons(v: FormDataEntryValue | string | null | undefined): boolean {
  return v == null ? true : String(v) !== "0";
}

/** Motif à poser sur un mouvement importé. Une entrée n'a jamais de motif de sortie. */
export function categorieSortieImport(type: string, sortiesLivraison: boolean): typeof MOTIF_LIVRAISON_RESTAURANT | null {
  return type === "SORTIE" && sortiesLivraison ? MOTIF_LIVRAISON_RESTAURANT : null;
}
