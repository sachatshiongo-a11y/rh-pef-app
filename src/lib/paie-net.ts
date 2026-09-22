/**
 * SALAIRE NET ET TOTAL VERSÉ — la seule soustraction du dépôt (décision Direction 2026-09-22).
 *
 * `PayrollLine.salNetUSD` porte, depuis le 2026-07-22, le TOTAL VERSÉ au salarié : salaire net
 * + indemnité de transport. C'est le montant réellement payé sur des mois clos et imprimé sur les
 * bulletins émis — on ne le réécrit pas. Le SALAIRE NET (ce que le salarié gagne, hors
 * remboursement de frais) se DÉRIVE ici, et nulle part ailleurs : `salNetUSD − transportUSD`.
 *
 * Il inclut les allocations familiales et les frais médicaux remboursés, et il est diminué de
 * l'acompte et de l'échéance de prêt — comme le net stocké. Seul le transport en sort.
 *
 * Module sans dépendance : importé par les composants client (simulation de salaire) comme par
 * les routes, les exports et les documents PDF.
 */

/** Ce que Prisma (`Decimal`), le moteur (`number`) ou une API (`string`) peuvent fournir. */
type Montant = number | string | { toString(): string };
export type LigneNet = { salNetUSD: Montant; transportUSD: Montant };

const n = (v: Montant): number => (typeof v === "number" ? v : Number(v.toString()));

/** Salaire net = total versé − transport. */
export function salaireNetUSD(l: LigneNet): number {
  return n(l.salNetUSD) - n(l.transportUSD);
}

/**
 * Le même, en CDF, au taux du bulletin. Le taux est PASSÉ (`run.tauxChangeUtilise`), jamais déduit
 * de `salNetCDF / salNetUSD` : un net nul donnerait NaN.
 */
export function salaireNetCDF(l: LigneNet, tauxChangeCDF: number): number {
  return salaireNetUSD(l) * tauxChangeCDF;
}

/** Total versé = salaire net + transport = la somme remise en main propre. */
export function totalVerseUSD(l: LigneNet): number {
  return n(l.salNetUSD);
}
