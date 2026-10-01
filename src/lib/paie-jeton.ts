/**
 * JETON D'AFFICHAGE d'une ligne de paie : ce que l'écran a montré (net, brut, base imposable, au
 * centime, ET le taux de change de la paie qui donne les montants en francs). La validation et le
 * paiement le recomparent à la ligne verrouillée (`controlerLignesAValider`, `controlerLignesAPayer`) :
 * si la ligne a été RECALCULÉE depuis l'affichage, ou si le taux a changé, la Direction ne valide pas
 * et personne ne paie un montant qu'il n'a pas lu.
 *
 * Pourquoi : depuis le 2026-10-01, une ligne ROUVERTE (qui a un historique) est mise à jour en place
 * par le recalcul — son identifiant ne change plus, et ce changement d'identifiant était jusque-là la
 * seule chose qui trahissait un écran périmé. Un brouillon sans historique, lui, change toujours
 * d'identifiant ; le jeton couvre les deux.
 *
 * Le TAUX (décision de Sacha du 2026-10-01) : chaque recalcul reporte le taux du jour sur la paie du
 * mois (`PayrollRun.tauxChangeUtilise`, paie-refresh.ts), y compris pour les lignes déjà validées
 * dont les montants en dollars, eux, sont figés. Un taux changé entre l'affichage et le clic change
 * les francs à remettre : refusé, avec un message qui le dit.
 *
 * Module PUR : pages (serveur) et contrôles partagent la règle.
 */
type MontantsLigne = { salNetUSD: unknown; salBrutUSD: unknown; netImposableUSD: unknown };

const centimes = (v: unknown) => Number(v).toFixed(2);

/** Ce qu'une requête Prisma doit lire d'une ligne pour en calculer le jeton. */
export const SELECTION_JETON = {
  salNetUSD: true,
  salBrutUSD: true,
  netImposableUSD: true,
  payrollRun: { select: { tauxChangeUtilise: true } },
} as const;

/** Jeton d'une ligne, au taux de change de sa paie (`run.tauxChangeUtilise`). */
export function jetonLigne(l: MontantsLigne, tauxChangeCDF: unknown): string {
  return [l.salNetUSD, l.salBrutUSD, l.netImposableUSD, tauxChangeCDF].map(centimes).join("|");
}

/** Jeton d'une ligne lue avec `SELECTION_JETON`. */
export const jetonDeLigneLue = (l: MontantsLigne & { payrollRun: { tauxChangeUtilise: unknown } }) => jetonLigne(l, l.payrollRun.tauxChangeUtilise);

/**
 * Ce qui sépare le jeton affiché du jeton actuel : rien, le seul taux (mêmes dollars, autres francs),
 * ou les montants eux-mêmes.
 */
export function ecartJeton(affiche: string, actuel: string): "AUCUN" | "TAUX" | "MONTANTS" {
  if (affiche === actuel) return "AUCUN";
  const a = affiche.split("|");
  const b = actuel.split("|");
  return a.length === 4 && a.slice(0, 3).join("|") === b.slice(0, 3).join("|") ? "TAUX" : "MONTANTS";
}
