// MOTIF OBLIGATOIRE DE TOUTE SORTIE DE STOCK — module pur (écrans, actions, moteurs).
//
// Décision de Sacha (2026-10-07) : « le motif est obligatoire pour toute sortie de stock », pour tous
// les rôles, Direction comprise, sur tous les chemins qui créent une SORTIE. Le motif est la catégorie
// de sortie (`MouvementStock.categorieSortie`) : « Livraison restaurant » ou « Perte » (raison
// obligatoire). Il est choisi à l'écran (sortie manuelle, validation d'une ancienne demande) ou
// déterminé par le chemin lui-même (import : « Livraison restaurant »).
//
// Les sorties SANS motif déjà en base ne sont jamais réécrites ici : la Direction les requalifie
// elle-même (Mouvements → filtre « Sorties : sans motif » → « Changer le motif »).

export const MOTIFS_SORTIE = { LIVRAISON_RESTAURANT: "Livraison restaurant", PERTE: "Perte" } as const;
export type MotifSortieObligatoire = keyof typeof MOTIFS_SORTIE;

export const estMotifSortie = (v: unknown): v is MotifSortieObligatoire =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(MOTIFS_SORTIE, v);

export const MESSAGE_MOTIF_SORTIE = "Choisissez le motif de la sortie (« Livraison restaurant » ou « Perte ») : une sortie sans motif n'est pas acceptée. Rien n'a été enregistré.";
export const MESSAGE_RAISON_PERTE = "Indiquez la raison de la perte.";

/**
 * Motif d'un mouvement à écrire : une SORTIE doit porter un motif connu (sinon refus lisible) ; une
 * entrée ou un ajustement n'en a jamais (null).
 */
export function exigerMotifSortie(type: string, categorie: unknown): MotifSortieObligatoire | null {
  if (type !== "SORTIE") return null;
  if (!estMotifSortie(categorie)) throw new Error(MESSAGE_MOTIF_SORTIE);
  return categorie;
}

/** Libellé d'origine posé automatiquement sur une sortie selon son motif (« Perte — moisi »). */
export const origineDuMotif = (motif: MotifSortieObligatoire, raison: string | null) =>
  motif === "PERTE" ? `Perte${raison ? ` — ${raison}` : ""}` : MOTIFS_SORTIE[motif];
