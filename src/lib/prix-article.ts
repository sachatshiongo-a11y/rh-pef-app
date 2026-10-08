// PRIX DE RÉFÉRENCE D'UN ARTICLE (catalogue Stock) — module PUR, seule porte de LECTURE du prix.
//
// Demande de la Direction (2026-10-08) : « prix unitaire des articles en francs congolais aussi ».
// Règle maison (reprise de Bolimo) : LA DEVISE DE SAISIE FAIT FOI. Un article a son prix soit en
// dollars (`devisePrix` USD, `prixUnitaireUSD`), soit en francs (`devisePrix` CDF, `prixUnitaireCDF`) ;
// l'autre devise ne se stocke jamais, elle s'AFFICHE « ≈ » au taux du jour (Config.tauxChangeCDF).
// Jamais d'aller-retour : un article à 7 000 FC vaut 7 000 FC, quel que soit le taux ; seul son
// équivalent en dollars bouge avec le taux.
//
// Les calculs qui exigent des dollars (coût des fiches techniques, valeur du stock, consommation)
// passent par `prixArticleEnUSD` : un article en USD rend son prix EXACT (aucun chiffre existant ne
// change) ; un article en francs rend `francs ÷ taux du jour`, marqué `approx` (« ≈ ») ; un taux
// absent ou nul rend `null` (« — »), JAMAIS 0.

import Decimal from "decimal.js";
import { formaterFC, formaterUSD } from "@/lib/montant";

export type DevisePrix = "USD" | "CDF";

/** Ce qu'il faut lire d'un article pour connaître son prix (champs Prisma, Decimal ou texte). */
export type PrixArticleBrut = {
  devisePrix?: DevisePrix | null; // absent (ancienne lecture) = USD
  prixUnitaireUSD: { toString(): string } | string | number | null;
  prixUnitaireCDF?: { toString(): string } | string | number | null;
};

/** Le prix tel que SAISI : sa devise et son montant (texte décimal exact). `null` = pas de prix. */
export type PrixSaisi = { devise: DevisePrix; montant: string };

const texte = (v: { toString(): string } | string | number | null | undefined): string | null =>
  v === null || v === undefined || String(v).trim() === "" ? null : String(v);

/** Taux utilisable (> 0) ou null. */
export const tauxUtilisable = (taux: number | null | undefined): number | null => (taux !== null && taux !== undefined && Number.isFinite(taux) && taux > 0 ? taux : null);

/** Le prix de référence dans SA devise de saisie, ou null s'il n'y en a pas. */
export function prixSaisi(a: PrixArticleBrut): PrixSaisi | null {
  if (a.devisePrix === "CDF") {
    const m = texte(a.prixUnitaireCDF);
    return m === null ? null : { devise: "CDF", montant: m };
  }
  const m = texte(a.prixUnitaireUSD);
  return m === null ? null : { devise: "USD", montant: m };
}

/** Un montant dans une devise demandée : exact si c'est la devise de saisie, sinon « ≈ » au taux. */
export type PrixConverti = { valeur: number; approx: boolean };

/**
 * Équivalent en DOLLARS du prix de référence (texte décimal pleine précision, pour Decimal) :
 * USD → le prix exact (`approx` faux) ; FC → francs ÷ taux du jour (`approx` vrai) ; pas de prix ou
 * taux absent pour un article en francs → null.
 */
export function prixArticleEnUSDTexte(a: PrixArticleBrut, taux: number | null | undefined): { valeur: string; approx: boolean } | null {
  const p = prixSaisi(a);
  if (!p) return null;
  if (p.devise === "USD") return { valeur: p.montant, approx: false };
  const t = tauxUtilisable(taux);
  if (t === null) return null;
  return { valeur: new Decimal(p.montant).div(t).toString(), approx: true };
}

/** Comme `prixArticleEnUSDTexte`, en nombre (affichage, totaux). */
export function prixArticleEnUSD(a: PrixArticleBrut, taux: number | null | undefined): PrixConverti | null {
  const r = prixArticleEnUSDTexte(a, taux);
  return r === null ? null : { valeur: Number(r.valeur), approx: r.approx };
}

/** Équivalent en FRANCS : FC → le prix exact ; USD → dollars × taux du jour (« ≈ ») ; sinon null. */
export function prixArticleEnCDF(a: PrixArticleBrut, taux: number | null | undefined): PrixConverti | null {
  const p = prixSaisi(a);
  if (!p) return null;
  if (p.devise === "CDF") return { valeur: Number(p.montant), approx: false };
  const t = tauxUtilisable(taux);
  if (t === null) return null;
  return { valeur: new Decimal(p.montant).times(t).toNumber(), approx: true };
}

/** Prix dans la devise demandée (celle d'une ligne d'achat, d'un bon…) : exact ou « ≈ ». */
export function prixArticleEn(a: PrixArticleBrut, devise: DevisePrix, taux: number | null | undefined): PrixConverti | null {
  return devise === "USD" ? prixArticleEnUSD(a, taux) : prixArticleEnCDF(a, taux);
}

/**
 * Valeur d'une quantité de cet article EN DOLLARS (valeur du stock, consommation) : quantité × prix
 * en dollars, « ≈ » si l'article est en francs ; null sans prix ou sans taux (jamais 0).
 */
export function valeurEnUSD(a: PrixArticleBrut, quantite: number, taux: number | null | undefined): PrixConverti | null {
  const p = prixArticleEnUSDTexte(a, taux);
  if (p === null) return null;
  return { valeur: new Decimal(p.valeur).times(quantite).toNumber(), approx: p.approx };
}

/** Prix unitaire formaté dans une devise : FC sans décimale, $ au centime — ou à 4 décimales s'il en a. */
export function formaterPrix(valeur: number, devise: DevisePrix): string {
  if (devise === "CDF") return formaterFC(valeur);
  // Un prix d'achat peut avoir plus de deux décimales (0,1786 $ le sachet) : on ne le tronque pas.
  const quatre = Math.round(valeur * 10000) / 10000;
  if (Math.abs(quatre - Math.round(quatre * 100) / 100) < 1e-9) return formaterUSD(quatre);
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Math.abs(quatre)).replace(/[  ]/g, " ")} $`;
}

/**
 * Libellés d'affichage : `principal` = le prix dans sa devise de saisie (« 7 000 FC ») ; `autre` =
 * l'autre devise au taux du jour (« ≈ 2,50 $ »), ou « ≈ — » si le taux manque ; `principal` vaut
 * « — » sans prix (et `autre` est alors null).
 */
export function libellesPrix(a: PrixArticleBrut, taux: number | null | undefined): { principal: string; autre: string | null; devise: DevisePrix | null } {
  const p = prixSaisi(a);
  if (!p) return { principal: "—", autre: null, devise: null };
  const principal = formaterPrix(Number(p.montant), p.devise);
  const autreDevise: DevisePrix = p.devise === "USD" ? "CDF" : "USD";
  const conv = prixArticleEn(a, autreDevise, taux);
  return { principal, autre: conv === null ? "≈ —" : `≈ ${formaterPrix(conv.valeur, autreDevise)}`, devise: p.devise };
}

/** « 7 000 FC (≈ 2,50 $) » sur une ligne — exports, PDF, listes. */
export function libellePrixComplet(a: PrixArticleBrut, taux: number | null | undefined): string {
  const l = libellesPrix(a, taux);
  return l.autre === null ? l.principal : `${l.principal} (${l.autre})`;
}

/**
 * Prix proposé à la SAISIE dans une devise donnée (texte de saisie à la française) : FC arrondi au
 * franc, USD à 4 décimales au plus. `null` sans prix ou sans taux.
 */
export function prixProposeEn(a: PrixArticleBrut, devise: DevisePrix, taux: number | null | undefined): number | null {
  const c = prixArticleEn(a, devise, taux);
  if (c === null || !(c.valeur > 0)) return null;
  if (!c.approx) return c.valeur;
  return devise === "CDF" ? Math.round(c.valeur) : Math.round(c.valeur * 10000) / 10000;
}

/**
 * Prix de référence d'un article CRÉÉ à la volée par la Liste d'achat (décision Direction
 * 2026-10-08) : le prix unitaire de la ligne (montant ÷ quantité) DANS SA DEVISE. Ligne en francs →
 * article en francs (`devisePrix` CDF, `prixUnitaireCDF`, `prixUnitaireUSD` NULL : contrainte
 * `ArticleStock_prix_devise_check`) ; ligne en dollars → article en dollars, comme avant. Arrondi à
 * la précision de la colonne : 4 décimales en dollars (règle d'avant, inchangée), 2 en francs
 * (Decimal(16, 2)). Sans montant, ou prix arrondi à 0 : pas de prix (NULL, jamais 0), la devise de
 * la ligne est retenue.
 */
export function prixReferenceNouvelArticle(devise: DevisePrix, montant: number | null, quantite: number): { devisePrix: DevisePrix; prixUnitaireUSD: number | null; prixUnitaireCDF: number | null } {
  const pu = montant !== null && Number.isFinite(montant) && montant > 0 && quantite > 0 ? montant / quantite : null;
  // Un prix si petit qu'il s'arrondit à 0 (100 FC pour 25 000 g) : pas de prix, jamais 0.
  const arrondi = (decimales: number) => { if (pu === null) return null; const r = Math.round(pu * 10 ** decimales) / 10 ** decimales; return r > 0 ? r : null; };
  if (devise === "CDF") return { devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: arrondi(2) };
  return { devisePrix: "USD", prixUnitaireUSD: arrondi(4), prixUnitaireCDF: null };
}
