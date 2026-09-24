// Frais médicaux saisis à la main sur la fiche (`Employee.fraisMedicauxMoisCourant`) et réouverture
// d'une ligne de paie — module PUR. Décision Direction 2026-09-24 : « garder les frais médicaux sur
// une ligne rouverte ».
//
// Valider une ligne (PAS_VALIDE → VALIDÉ) remet la fiche à zéro : le montant est figé sur la ligne.
// Rouvrir la ligne (VALIDÉ → PAS_VALIDE) doit le RESTITUER à la fiche, sinon le recalcul suivant lit
// une fiche vide et les frais disparaissent du bulletin. Ce qui est restitué est EXACTEMENT ce que la
// dernière validation a remis à zéro — jamais `ligne.fraisMedicauxUSD`, qui contient aussi les frais
// de la table `FraisMedical` : le recalcul les relit lui-même, les restituer à la fiche les doublerait.
//
// La validation note ce montant dans son instantané (`VersionBulletin.snapshot.validation`). Une
// annulation de paiement (PAYÉ → VALIDÉ) crée aussi un instantané, mais ne remet rien à zéro : elle
// est sautée.

/** Ce que la validation inscrit dans l'instantané du bulletin. */
export type TraceValidation = { deStatut: string; fraisMedicauxFicheRemisAZeroUSD: number };

type Instantane = { validation?: TraceValidation; employe?: { fraisMedicauxMoisCourant?: unknown } } | null | undefined;

/**
 * Montant à restituer à la fiche quand on rouvre une ligne.
 * `versions` : instantanés de la ligne, du plus récent au plus ancien.
 * `transitionsVersValide` : `deStatut` de chaque transition vers VALIDÉ de la ligne (tout ordre).
 *
 * - Instantané récent (avec `validation`) : celui de la dernière validation depuis PAS_VALIDE.
 * - Lignes validées AVANT cette règle (instantanés sans `validation`) : l'instantané gardait la fiche
 *   AVANT sa remise à zéro. Il n'est sûr que si la ligne n'a jamais connu d'annulation de paiement
 *   (chaque instantané est alors celui d'une validation) ; sinon, 0 plutôt qu'un montant deviné.
 */
export function fraisMedicauxARestituer(versions: Instantane[], transitionsVersValide: string[]): number {
  for (const v of versions) {
    if (v?.validation) {
      if (v.validation.deStatut === "PAS_VALIDE") return Number(v.validation.fraisMedicauxFicheRemisAZeroUSD) || 0;
      continue; // annulation d'un paiement : rien n'a été remis à zéro
    }
    // Premier instantané sans trace : toute la suite est antérieure à la règle.
    if (transitionsVersValide.some((de) => de !== "PAS_VALIDE")) return 0;
    return Number(v?.employe?.fraisMedicauxMoisCourant ?? 0) || 0;
  }
  return 0;
}
