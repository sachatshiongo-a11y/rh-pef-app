/**
 * Quand l'attestation de paie d'un mois peut-elle être délivrée ? Décision de la Direction du
 * 2026-10-12 : seulement une fois le bulletin PAYÉ. Module PUR, partagé par la route (refus 409) et
 * l'écran (lien remplacé par la raison) : un seul texte, jamais deux règles.
 */
export function refusAttestationPaie(statutPaiement: string): string | null {
  if (statutPaiement === "PAYE") return null;
  if (statutPaiement === "VALIDE") return "Ce bulletin est validé mais pas encore payé : l'attestation de paie se délivre une fois le salaire versé.";
  return "Cette paie n'est pas encore validée ni payée : elle ne peut pas être attestée.";
}
