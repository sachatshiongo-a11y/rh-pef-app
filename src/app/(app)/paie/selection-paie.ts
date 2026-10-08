// Sélection d'un lot de paie — module PUR, partagé par /paie (paie-bulk.tsx) et « À valider »
// (bulletins-inbox.tsx). Correction 1 (2026-09-24), point 2.
//
// Chaque ouverture de /paie remplace les lignes non figées SANS historique (paie-refresh.ts ; une
// ligne rouverte, elle, est mise à jour en place) : leurs IDENTIFIANTS changent, alors que l'état de l'écran (la sélection) survit au nouveau rendu. Une
// sélection d'identifiants envoyait donc au serveur des lignes disparues, et le lot était refusé
// (« La paie a été recalculée depuis l'affichage ») sans qu'aucun montant ait changé.
//
// La sélection retient donc des SALARIÉS (les deux écrans ne montrent que le mois courant : un
// salarié = une ligne), et l'action reçoit les identifiants des lignes AFFICHÉES au moment du clic :
// celles dont l'écran montre le montant. Le contrôle du montant côté serveur reste entier.

/**
 * Clé de sélection d'une ligne : le salarié, stable d'un recalcul à l'autre — et, pour une ligne d'un
 * AUTRE mois que le mois courant (« À valider » liste depuis le 2026-10-08 les bulletins validés des
 * mois clôturés), le salarié ET ce mois : sinon cocher « Ada — septembre » cochait aussi « Ada —
 * octobre » et le lot payait les deux. Les lignes du mois courant gardent la clé « salarié ».
 */
export const cleSelection = (l: { employeeId: string; periode?: string | null }) =>
  l.periode ? `${l.employeeId}|${l.periode}` : l.employeeId;

/**
 * Identifiants COURANTS des lignes sélectionnées, et nombre de salariés sélectionnés qui n'ont plus
 * de ligne affichée (fiche désactivée, ligne sortie de la liste) : écartés, et l'écran le dit.
 */
export function lignesSelectionnees<T extends { id: string; employeeId: string; periode?: string | null }>(
  lignes: readonly T[],
  selection: ReadonlySet<string>,
): { ids: string[]; ecartes: number } {
  const ids = lignes.filter((l) => selection.has(cleSelection(l))).map((l) => l.id);
  const presents = new Set(lignes.map(cleSelection));
  const ecartes = [...selection].filter((k) => !presents.has(k)).length;
  return { ids, ecartes };
}

/** Phrase affichée quand des salariés sélectionnés n'ont plus de ligne, sinon null. */
export function messageEcartes(ecartes: number): string | null {
  if (ecartes <= 0) return null;
  return ecartes === 1
    ? "1 salarié sélectionné n'a plus de ligne à l'écran : il est écarté du lot."
    : `${ecartes} salariés sélectionnés n'ont plus de ligne à l'écran : ils sont écartés du lot.`;
}

// ── « Marquer payé » par la RH (2026-10-01) ─────────────────────────────────────────────────────
// La RH ne paie que ce que la Direction a validé. Dans un lot mixte, les lignes non validées (ou déjà
// payées) sont ÉCARTÉES et NOMMÉES avant l'envoi ; le serveur, lui, les refuse de toute façon.

const ETAT_ECARTE: Record<string, string> = { PAS_VALIDE: "pas encore validé par la Direction", PAYE: "déjà payé" };

/** Lignes à payer (VALIDÉES) parmi `ids`, et lignes écartées avec leur raison. */
export function partagerPourPaiement<T extends { id: string; nom: string; statutPaiement: string }>(
  lignes: readonly T[],
  ids: readonly string[],
): { aPayer: string[]; ecartees: { nom: string; raison: string }[] } {
  const choisies = lignes.filter((l) => ids.includes(l.id));
  return {
    aPayer: choisies.filter((l) => l.statutPaiement === "VALIDE").map((l) => l.id),
    ecartees: choisies.filter((l) => l.statutPaiement !== "VALIDE").map((l) => ({ nom: l.nom, raison: ETAT_ECARTE[l.statutPaiement] ?? l.statutPaiement })),
  };
}

/** Confirmation d'un lot mixte (null si rien n'est écarté). */
export function messageEcarteesPaiement(ecartees: readonly { nom: string; raison: string }[], aPayer: number): string | null {
  if (ecartees.length === 0) return null;
  const liste = ecartees.map((e) => `• ${e.nom} (${e.raison})`).join("\n");
  const question = aPayer > 1 ? `Marquer payés les ${aPayer} bulletins validés ?` : "Marquer payé le bulletin validé ?";
  return `Seuls les bulletins validés par la Direction sont payés. Écarté${ecartees.length > 1 ? "s" : ""} du lot :\n${liste}\n\n${question}`;
}
