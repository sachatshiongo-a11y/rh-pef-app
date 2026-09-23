// Confirmation AVANT validation de la paie — module PUR. Décision Direction 2026-09-23 : les
// avertissements ne bloquent jamais ; ils sont montrés une fois, clairement, au moment de valider.
import type { AvertissementPaie } from "@/lib/paie-reference";

export type LigneAAvertir = { nom: string; avertissements: AvertissementPaie[] };

/** Au-delà, la boîte du navigateur devient illisible : on résume le reste en une ligne. */
export const MAX_SALARIES_CONFIRMATION = 10;

/**
 * Message de la boîte de confirmation, ou `null` s'il n'y a rien à signaler (validation directe).
 * Au plus MAX_SALARIES_CONFIRMATION salariés sont détaillés (tous leurs avertissements, chaque
 * message ENTIER — jamais coupé au milieu) ; les suivants sont comptés dans « … et N autres ».
 */
export function messageConfirmationValidation(lignes: LigneAAvertir[]): string | null {
  const aSignaler = lignes.filter((l) => l.avertissements.length > 0);
  if (aSignaler.length === 0) return null;
  const montres = aSignaler.slice(0, MAX_SALARIES_CONFIRMATION);
  const puces = montres.flatMap((l) => l.avertissements.map((a) => `• ${l.nom} — ${a.message}`));
  const reste = aSignaler.length - montres.length;
  if (reste > 0) {
    puces.push(`… et ${reste} ${reste === 1 ? "autre salarié" : "autres salariés"} avec des avertissements`);
  }
  return `Avant de valider (la validation reste possible) :\n\n${puces.join("\n")}\n\nValider quand même ?`;
}

/**
 * Lignes d'un lot qui vont RÉELLEMENT être validées : cochées ET « pas validé » (le serveur
 * ignore les autres ; « Valider » sur une ligne payée serait une réouverture, pas une validation).
 * À appeler sur TOUTES les lignes, pas seulement celles du filtre affiché : une ligne cochée
 * puis masquée par le filtre part aussi au lot.
 */
export function lignesAValiderDuLot<T extends LigneAAvertir & { id: string; statutPaiement: string }>(
  lignes: T[],
  selection: ReadonlySet<string>,
): T[] {
  return lignes.filter((l) => selection.has(l.id) && l.statutPaiement === "PAS_VALIDE");
}
