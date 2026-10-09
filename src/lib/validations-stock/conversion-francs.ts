// CONVERSION D'UN RÈGLEMENT ENTRE DOLLARS ET FRANCS — module PUR (ni base ni session), partagé par le
// serveur (reglement.ts : paiement direct, lot, demande validée) et par les écrans qui l'annoncent
// AVANT le paiement (« 280 000 FC ≈ 100,00 $ au taux du 08/10 »). Une seule formule par sens :
// l'écran ne peut pas annoncer un autre chiffre que celui que le serveur écrira (au même taux).
//
// Depuis le 2026-10-09, une facture peut être tenue en FRANCS : payée en francs, son reste diminue
// en francs sans conversion ; payée en dollars, les dollars sont convertis au taux du jour du
// paiement (sens inverse de la conversion d'origine). `imputation` est LA règle qui dit ce qu'un
// montant versé retire du reste d'une facture, dans la devise de la facture.

export type DeviseReglement = "USD" | "CDF";

/** LA conversion d'un règlement en francs sur une facture en dollars : francs ÷ taux, au centime. */
export const francsEnDollars = (montantCDF: number, taux: number): number => Math.round((montantCDF / taux) * 100) / 100;

/** Francs proposés pour régler un reste en dollars : reste × taux, au franc (relus par `francsEnDollars`, ils redonnent le reste). */
export const francsPourReste = (resteUSD: number, taux: number): number => Math.round(resteUSD * taux);

/** Sens inverse (facture en francs payée en dollars) : dollars × taux, au centime de franc. */
export const dollarsEnFrancs = (montantUSD: number, taux: number): number => Math.round(montantUSD * taux * 100) / 100;

/** Dollars proposés pour solder un reste en francs : reste ÷ taux, au centime (relus par `imputation`, ils soldent). */
export const dollarsPourReste = (resteCDF: number, taux: number): number => Math.round((resteCDF / taux) * 100) / 100;

/**
 * Tolérance d'arrondi d'un paiement en dollars sur une facture en francs : un DEMI-CENTIME converti
 * (taux × 0,005 FC). Un dollar ne s'écrit qu'au centime ; 1 centime vaut ~28 FC au taux de 2 800 :
 * aucun montant en dollars ne tombe exactement sur un reste en francs quelconque. C'est la même
 * tolérance que dans l'autre sens (francs → dollars arrondis au centime le plus proche).
 */
export const toleranceDollars = (taux: number): number => taux * 0.005 + 0.01;
// (+ 0,01 FC : marge d'arrondi — à un taux non entier, le centime le plus proche d'un reste tombe
// pile sur le demi-centime ; sans elle, les dollars PROPOSÉS par l'écran seraient refusés. Relecture.)

/** Écart toléré quand le montant versé est dans la devise de la facture (arrondi au centime). */
export const TOLERANCE_MEME_DEVISE = 0.009;

/**
 * Ce qu'un montant VERSÉ retire du reste d'une facture, DANS LA DEVISE DE LA FACTURE :
 * - même devise : le montant tel quel (pas de taux) ;
 * - francs sur une facture en dollars : `francsEnDollars` (règle du 2026-10-08, inchangée) ;
 * - dollars sur une facture en francs : `dollarsEnFrancs` ; à un demi-centime près du reste, le
 *   paiement SOLDE la facture (imputé = le reste exact).
 * `depasse` : le versement vaut plus que le reste (au-delà de la tolérance) — le serveur le refuse.
 * `null` : une conversion est nécessaire et le taux manque (jamais un taux supposé).
 */
export function imputation(
  deviseFacture: DeviseReglement,
  verse: { devise: DeviseReglement; montant: number },
  taux: number | null,
  reste: number,
): { impute: number; depasse: boolean; converti: boolean } | null {
  if (verse.devise === deviseFacture) return { impute: verse.montant, depasse: verse.montant > reste + TOLERANCE_MEME_DEVISE, converti: false };
  if (taux === null || !(taux > 0)) return null;
  if (deviseFacture === "USD") {
    const usd = francsEnDollars(verse.montant, taux);
    return { impute: usd, depasse: usd > reste + TOLERANCE_MEME_DEVISE, converti: true };
  }
  const fc = dollarsEnFrancs(verse.montant, taux);
  const tol = toleranceDollars(taux);
  if (Math.abs(fc - reste) <= tol) return { impute: reste, depasse: false, converti: true };
  return { impute: fc, depasse: fc > reste + tol, converti: true };
}
