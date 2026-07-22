// Prêts au personnel — logique de retenue mensuelle. Fonction PURE (aucune I/O, uniquement des
// nombres en entrée/sortie), même convention que src/lib/payroll.ts.

export type RetenuePretLigne = { mois: number; annee: number; montantUSD: number };

export type EcheancePret = {
  /** Montant à retenir CE mois (0 si le prêt était déjà soldé avant ce mois). */
  echeanceUSD: number;
  /** Solde restant dû AVANT la retenue de ce mois (exclut la retenue déjà enregistrée pour ce
   *  mois précis, afin qu'un recalcul du même mois reste idempotent). */
  soldeAvantUSD: number;
};

/**
 * Échéance de prêt du mois : min(retenue mensuelle contractuelle, solde restant dû avant ce mois).
 * Extrait de 3 implémentations dupliquées (paie-batch.ts, bulletin-live.ts, paie/actions.ts) —
 * REFACTOR PUR, résultat numérique strictement identique à l'ancien code dans les 3 endroits.
 */
export function calculerEcheancePret(
  montantUSD: number,
  retenueMensuelleUSD: number,
  retenues: RetenuePretLigne[],
  mois: number,
  annee: number
): EcheancePret {
  const dejaRembourseHorsMois = retenues
    .filter((r) => !(r.mois === mois && r.annee === annee))
    .reduce((s, r) => s + r.montantUSD, 0);
  const soldeAvantUSD = montantUSD - dejaRembourseHorsMois;
  const echeanceUSD = soldeAvantUSD > 0 ? Math.min(retenueMensuelleUSD, soldeAvantUSD) : 0;
  return { echeanceUSD, soldeAvantUSD };
}
