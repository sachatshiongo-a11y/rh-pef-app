// CONVERSION D'UN RÈGLEMENT EN FRANCS — module PUR (ni base ni session), partagé par le serveur
// (reglement.ts : paiement direct, lot, demande validée) et par les écrans qui l'annoncent AVANT
// le paiement (« 280 000 FC ≈ 100,00 $ au taux du 08/10 »). Une seule formule : l'écran ne peut
// pas annoncer un autre chiffre que celui que le serveur écrira (au même taux).

/** LA conversion d'un règlement en francs : francs ÷ taux, au centime. */
export const francsEnDollars = (montantCDF: number, taux: number): number => Math.round((montantCDF / taux) * 100) / 100;

/** Francs proposés pour régler un reste en dollars : reste × taux, au franc (relus par `francsEnDollars`, ils redonnent le reste). */
export const francsPourReste = (resteUSD: number, taux: number): number => Math.round(resteUSD * taux);
