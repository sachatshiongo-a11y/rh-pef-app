// Sélection d'un lot de paie — module PUR, partagé par /paie (paie-bulk.tsx) et « À valider »
// (bulletins-inbox.tsx). Correction 1 (2026-09-24), point 2.
//
// Chaque ouverture de /paie supprime puis recrée les lignes non figées (paie-refresh.ts) : leurs
// IDENTIFIANTS changent, alors que l'état de l'écran (la sélection) survit au nouveau rendu. Une
// sélection d'identifiants envoyait donc au serveur des lignes disparues, et le lot était refusé
// (« La paie a été recalculée depuis l'affichage ») sans qu'aucun montant ait changé.
//
// La sélection retient donc des SALARIÉS (les deux écrans ne montrent que le mois courant : un
// salarié = une ligne), et l'action reçoit les identifiants des lignes AFFICHÉES au moment du clic :
// celles dont l'écran montre le montant. Le contrôle du montant côté serveur reste entier.

/** Clé de sélection d'une ligne : le salarié, stable d'un recalcul à l'autre. */
export const cleSelection = (l: { employeeId: string }) => l.employeeId;

/**
 * Identifiants COURANTS des lignes sélectionnées, et nombre de salariés sélectionnés qui n'ont plus
 * de ligne affichée (fiche désactivée, ligne sortie de la liste) : écartés, et l'écran le dit.
 */
export function lignesSelectionnees<T extends { id: string; employeeId: string }>(
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
