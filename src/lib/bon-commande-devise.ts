// MONTANTS D'UN BON DE COMMANDE DANS SA DEVISE — module PUR, seule porte de LECTURE du total d'un bon
// et du prix de ses lignes (audit du 10/10/2026, stock 19).
//
// Règles maison : la devise lue FAIT FOI (un bon importé d'un PDF en francs reste en francs, jamais
// converti au taux du jour) ; « — » jamais 0 pour une absence ; un montant incomplet est annoncé.
//  - Bon en dollars (`devise` USD, tous les bons d'avant) : `totalUSD`, lignes en `prixUnitaireUSD`.
//  - Bon en francs (`devise` CDF) : `totalCDF`, lignes en `prixUnitaireCDF` ; les colonnes en dollars sont NULLES.
//  - Ligne SANS PRIX : prix nul. Les lignes d'avant, saisies sans prix, portent 0 : elles sont lues
//    « sans prix » aussi (un bon de commande à 0 $ la ligne n'a pas de sens), sans être réécrites.

import type { Prisma } from "@prisma/client";
import { ajouterAuTotal, formaterMontantFacture, libelleTotal, totalVide, type DeviseFacture } from "@/lib/facture-devise";
import { usd as usdAffiche } from "@/lib/stock";

type Dec = { toString(): string } | string | number | null | undefined;
const num = (v: Dec): number | null => (v === null || v === undefined || String(v).trim() === "" ? null : Number(String(v)));

export type BonBrut = { devise?: DeviseFacture | null; totalUSD?: Dec; totalCDF?: Dec };
export type LigneBonBrute = { prixUnitaireUSD?: Dec; totalLigneUSD?: Dec; prixUnitaireCDF?: Dec; totalLigneCDF?: Dec };

export const deviseBon = (b: { devise?: DeviseFacture | null }): DeviseFacture => (b.devise === "CDF" ? "CDF" : "USD");

/** Total du bon dans SA devise ; null si absent. (Le total enregistré ne compte que les lignes avec prix.) */
export function totalBon(b: BonBrut): number | null {
  return deviseBon(b) === "CDF" ? num(b.totalCDF) : num(b.totalUSD);
}

/** Prix unitaire de la ligne dans la devise du bon ; null = SANS PRIX (nul, ou 0 d'une ancienne saisie sans prix). */
export function prixLigneBon(l: LigneBonBrute, devise: DeviseFacture): number | null {
  const p = num(devise === "CDF" ? l.prixUnitaireCDF : l.prixUnitaireUSD);
  return p === null || !(p > 0) ? null : p;
}

/** Total de la ligne dans la devise du bon ; null si la ligne est sans prix. */
export function totalLigneBon(l: LigneBonBrute, devise: DeviseFacture): number | null {
  if (prixLigneBon(l, devise) === null) return null;
  return num(devise === "CDF" ? l.totalLigneCDF : l.totalLigneUSD);
}

export const ligneSansPrixBon = (l: LigneBonBrute, devise: DeviseFacture): boolean => prixLigneBon(l, devise) === null;
export const compterSansPrixBon = (lignes: LigneBonBrute[], devise: DeviseFacture): number => lignes.filter((l) => ligneSansPrixBon(l, devise)).length;

/** Montant formaté dans la devise du bon. */
export const formaterMontantBon = (n: number, devise: DeviseFacture, fmtUSD: (v: number) => string = (v) => usdAffiche(v)): string =>
  devise === "CDF" ? formaterMontantFacture(n, "CDF") : fmtUSD(n);

/**
 * Le total du bon tel qu'il s'écrit : « — » quand il n'y a rien de chiffré (aucun total, ou un 0 que
 * seules des lignes sans prix expliquent) ; sinon le montant, suivi de « (incomplet : N ligne(s) sans
 * prix) » quand des lignes ne sont pas chiffrées — jamais un total partiel présenté comme complet.
 */
export function libelleTotalBon(b: BonBrut, nbSansPrix: number, nbLignes: number, fmtUSD?: (v: number) => string): string {
  const devise = deviseBon(b);
  const total = totalBon(b);
  const incomplet = nbSansPrix > 0 ? ` (incomplet : ${nbSansPrix} ligne(s) sans prix)` : "";
  if (total === null || (total === 0 && (nbSansPrix > 0 || nbLignes === 0))) return `—${incomplet}`;
  return `${formaterMontantBon(total, devise, fmtUSD)}${incomplet}`;
}

/** Lignes SANS PRIX en base (prix nul ou 0 dans les deux devises) : pour compter par bon (`_count`), sans charger les lignes. */
export const WHERE_LIGNE_SANS_PRIX = {
  AND: [
    { OR: [{ prixUnitaireUSD: null }, { prixUnitaireUSD: 0 }] },
    { OR: [{ prixUnitaireCDF: null }, { prixUnitaireCDF: 0 }] },
  ],
} satisfies Prisma.LigneBonDeCommandeWhereInput;

/** Un bon vu d'une liste : son total (dans sa devise), sa devise, ses lignes sans prix. */
export type BonDeListe = { total: number | null; devise?: DeviseFacture; sansPrix?: number; nbLignes?: number };

/** Total d'un bon pour une LISTE : « — » sans total chiffré, « (incomplet) » quand des lignes n'ont pas de prix. */
export function libelleTotalListe(b: BonDeListe, fmtUSD?: (v: number) => string): string {
  const devise = b.devise ?? "USD";
  return libelleTotalBon(devise === "CDF" ? { devise, totalCDF: b.total } : { devise, totalUSD: b.total }, b.sansPrix ?? 0, b.nbLignes ?? 1, fmtUSD).replace(/\(incomplet : \d+ ligne\(s\) sans prix\)/, "(incomplet)");
}

/**
 * Total d'un groupe de bons (un mois) : dollars et francs à part, jamais additionnés ; « — » quand rien n'est
 * chiffré ; « · incomplet » dès qu'un bon du groupe a des lignes sans prix.
 */
export function libelleTotalGroupe(bons: BonDeListe[], fmtUSD?: (v: number) => string): string {
  let t = totalVide();
  for (const b of bons) if (b.total !== null) t = ajouterAuTotal(t, b.devise ?? "USD", b.total);
  const incomplet = bons.some((b) => (b.sansPrix ?? 0) > 0);
  const texte = t.usd === 0 && t.cdf === 0 ? "—" : libelleTotal(t, undefined, fmtUSD);
  return `${texte}${incomplet ? " · incomplet" : ""}`;
}

/** Le bon tel que les listes le lisent (total dans sa devise, lignes sans prix). */
export const bonDeListe = (b: BonBrut, sansPrix: number, nbLignes: number): BonDeListe => ({ total: totalBon(b), devise: deviseBon(b), sansPrix, nbLignes });
