// MOTIF DES SORTIES IMPORTÉES — module pur (écran d'import, actions, moteurs d'import).
//
// Décision de la Direction (2026-09-28) : les imports Excel/CSV ne posaient jamais de motif sur
// les sorties (1 093 sorties sur 1 107 sans motif). Désormais, une sortie importée reçoit le motif
// « Livraison restaurant ». Décision de Sacha (2026-10-07) : le motif est OBLIGATOIRE pour toute
// sortie — la case « sans motif » de l'écran d'import a disparu ; une demande « sans motif » (onglet
// resté ouvert) est REFUSÉE dès qu'il y a une sortie à importer, rien n'est écrit. La Direction
// requalifie ensuite au besoin (Mouvements → « Changer le motif »). Les sorties déjà en base ne
// sont JAMAIS requalifiées ici.

export const MOTIF_LIVRAISON_RESTAURANT = "LIVRAISON_RESTAURANT" as const;

/** Nom du champ envoyé par l'écran d'import : « 1 » = livraisons ; « 0 » (ancien écran) = sans motif, refusé s'il y a des sorties. */
export const CHAMP_SORTIES_LIVRAISON = "sortiesLivraison";

/**
 * Lit le choix de l'écran. Absent → OUI : c'est le défaut voulu. L'écran envoie donc TOUJOURS
 * « 1 » ou « 0 » explicitement (une case décochée n'est pas envoyée par un formulaire HTML :
 * la lire telle quelle ferait du décochage un « oui »).
 */
export function sortiesSontLivraisons(v: FormDataEntryValue | string | null | undefined): boolean {
  return v == null ? true : String(v) !== "0";
}

export const MESSAGE_IMPORT_SANS_MOTIF = "Ce fichier contient des sorties : leur motif est obligatoire (« Livraison restaurant » à l'import, à requalifier ensuite dans Mouvements si besoin). Rechargez la page d'import ; rien n'a été importé.";

/**
 * Motif à poser sur un mouvement importé : une SORTIE reçoit toujours « Livraison restaurant » (jamais
 * aucun motif : refus lisible si l'écran a demandé « sans motif ») ; une entrée n'en a jamais.
 */
export function categorieSortieImport(type: string, sortiesLivraison: boolean): typeof MOTIF_LIVRAISON_RESTAURANT | null {
  if (type !== "SORTIE") return null;
  if (!sortiesLivraison) throw new Error(MESSAGE_IMPORT_SANS_MOTIF);
  return MOTIF_LIVRAISON_RESTAURANT;
}
