/**
 * JETON D'AFFICHAGE d'une ligne de paie : ce que l'écran a montré (net, brut, base imposable, au
 * centime). La validation le recompare à la ligne verrouillée (`controlerLignesAValider`) : si la
 * ligne a été RECALCULÉE depuis l'affichage, la Direction ne valide pas un montant qu'elle n'a pas lu.
 *
 * Pourquoi : depuis le 2026-10-01, une ligne ROUVERTE (qui a un historique) est mise à jour en place
 * par le recalcul — son identifiant ne change plus, et ce changement d'identifiant était jusque-là la
 * seule chose qui trahissait un écran périmé. Un brouillon sans historique, lui, change toujours
 * d'identifiant ; le jeton couvre les deux. Module PUR : pages (serveur) et contrôle partagent la règle.
 */
type MontantsLigne = { salNetUSD: unknown; salBrutUSD: unknown; netImposableUSD: unknown };

const centimes = (v: unknown) => Number(v).toFixed(2);

export function jetonLigne(l: MontantsLigne): string {
  return [l.salNetUSD, l.salBrutUSD, l.netImposableUSD].map(centimes).join("|");
}
