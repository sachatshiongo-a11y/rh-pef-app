// MONTANTS D'UNE FACTURE FOURNISSEUR DANS SA DEVISE — module PUR, seule porte de LECTURE du montant,
// du réglé et du reste d'une facture.
//
// Demande de la Direction (2026-10-09) : « les factures fournisseurs doivent aussi être en francs
// congolais au choix ». Règle maison : LA DEVISE DE SAISIE FAIT FOI, jamais d'aller-retour. Une
// facture est soit en dollars (`devise` USD : `montantUSD`, `montantRegleUSD`, `resteAPayerUSD`), soit
// en francs (`devise` CDF : `montantCDF`, `montantRegleCDF`, `resteAPayerCDF`) — les colonnes de
// l'autre devise sont NULLES (contrainte `FactureFournisseur_devise_check`). L'autre devise ne se
// stocke jamais : elle s'affiche « ≈ » au taux du jour, « — » sans taux (jamais 0).
//
// Les factures d'avant le 2026-10-09 sont toutes en dollars : leur lecture rend EXACTEMENT les
// chiffres d'avant. Un total qui mélange les deux devises ne s'additionne pas en silence : il
// s'écrit « 1 234,50 $ + 2 800 000 FC » (`libelleTotal`), et son équivalent unique, s'il en faut
// un, est annoncé « ≈ » au taux du jour (`equivalentUSD`).

import Decimal from "decimal.js";
import { formaterUSD, normaliserEspaces } from "@/lib/montant";
import { tauxUtilisable } from "@/lib/prix-article";

export type DeviseFacture = "USD" | "CDF";
type Dec = { toString(): string } | string | number | null | undefined;

/** Ce qu'il faut lire d'une facture pour connaître ses montants (champs Prisma, Decimal ou texte). */
export type MontantsFactureBrut = {
  devise?: DeviseFacture | null; // absent (ancienne lecture) = USD
  montantUSD?: Dec; montantRegleUSD?: Dec; resteAPayerUSD?: Dec;
  montantCDF?: Dec; montantRegleCDF?: Dec; resteAPayerCDF?: Dec;
};

export const deviseFacture = (f: { devise?: DeviseFacture | null }): DeviseFacture => (f.devise === "CDF" ? "CDF" : "USD");

const texte = (v: Dec): string => (v === null || v === undefined || String(v).trim() === "" ? "0" : String(v));

/** Montant, réglé et reste dans la devise de la facture (nombres), plus le reste en texte EXACT (jeton). */
export function montantsFacture(f: MontantsFactureBrut): { devise: DeviseFacture; montant: number; regle: number; reste: number; resteTexte: string } {
  const devise = deviseFacture(f);
  const [m, r, x] = devise === "CDF" ? [f.montantCDF, f.montantRegleCDF, f.resteAPayerCDF] : [f.montantUSD, f.montantRegleUSD, f.resteAPayerUSD];
  return { devise, montant: Number(texte(m)), regle: Number(texte(r)), reste: Number(texte(x)), resteTexte: new Decimal(texte(x)).toString() };
}

/** Le reste à payer, dans la devise de la facture. */
export const resteFacture = (f: MontantsFactureBrut): number => montantsFacture(f).reste;

/** Un montant de facture formaté dans sa devise : « 1 234,50 $ » ; « 2 800 000 FC » (centimes de franc montrés s'il y en a). */
export function formaterMontantFacture(n: number, devise: DeviseFacture): string {
  // Négatif : entre parenthèses, jamais « − » (convention de src/lib/montant.ts) — jamais le signe perdu.
  const negatif = n <= -0.005;
  let texte: string;
  if (devise === "USD") texte = formaterUSD(n);
  else {
    const a = Math.abs(n);
    const entier = Math.abs(a - Math.round(a)) < 0.005;
    texte = `${normaliserEspaces(new Intl.NumberFormat("fr-FR", { minimumFractionDigits: entier ? 0 : 2, maximumFractionDigits: entier ? 0 : 2 }).format(entier ? Math.round(a) : a))} FC`;
  }
  return negatif ? `(${texte})` : texte;
}

/** Suffixe court d'une devise (en-têtes de colonnes) : « $ » ou « FC ». */
export const symboleDevise = (d: DeviseFacture) => (d === "USD" ? "$" : "FC");

// ── Totaux par devise ─────────────────────────────────────────────────────────────────────────────
/** Total d'un ensemble de factures, TENU PAR DEVISE (jamais additionné d'une devise à l'autre). */
export type TotalDevises = { usd: number; cdf: number; nbUSD: number; nbCDF: number };
export const totalVide = (): TotalDevises => ({ usd: 0, cdf: 0, nbUSD: 0, nbCDF: 0 });

const arr2 = (n: number) => Math.round(n * 100) / 100;

/** Ajoute un montant dans sa devise (renvoie un nouveau total, au centime). */
export function ajouterAuTotal(t: TotalDevises, devise: DeviseFacture, montant: number): TotalDevises {
  return devise === "CDF"
    ? { ...t, cdf: arr2(t.cdf + montant), nbCDF: t.nbCDF + 1 }
    : { ...t, usd: arr2(t.usd + montant), nbUSD: t.nbUSD + 1 };
}

/** Total d'une liste de factures, sur leur montant, leur réglé ou leur reste. */
export function totalFactures(fs: MontantsFactureBrut[], champ: "montant" | "regle" | "reste"): TotalDevises {
  return fs.reduce((t, f) => { const m = montantsFacture(f); return ajouterAuTotal(t, m.devise, m[champ]); }, totalVide());
}

/** Additionne deux totaux par devise. */
export const additionnerTotaux = (a: TotalDevises, b: TotalDevises): TotalDevises => ({ usd: arr2(a.usd + b.usd), cdf: arr2(a.cdf + b.cdf), nbUSD: a.nbUSD + b.nbUSD, nbCDF: a.nbCDF + b.nbCDF });

/**
 * Total lu d'un agrégat Prisma (`_sum` des deux colonnes d'une même grandeur, `_count` facultatif) :
 * une facture en dollars a sa colonne en francs NULLE, et inversement — la somme de chaque colonne
 * est donc exactement le total de sa devise.
 */
export function totalDepuisSommes(usd: Dec, cdf: Dec, nb: { usd?: number; cdf?: number } = {}): TotalDevises {
  return { usd: arr2(Number(texte(usd))), cdf: arr2(Number(texte(cdf))), nbUSD: nb.usd ?? 0, nbCDF: nb.cdf ?? 0 };
}

/** Les parts d'un total à afficher : la part en dollars, puis celle en francs — seulement celles qui ne sont pas nulles. */
export function partsTotal(t: TotalDevises): { devise: DeviseFacture; montant: number }[] {
  const parts: { devise: DeviseFacture; montant: number }[] = [];
  if (Math.abs(t.usd) >= 0.005) parts.push({ devise: "USD", montant: t.usd });
  if (Math.abs(t.cdf) >= 0.005) parts.push({ devise: "CDF", montant: t.cdf });
  return parts;
}

/**
 * « 1 234,50 $ + 2 800 000 FC » ; une seule devise : son seul montant (« 1 234,50 $ », exactement
 * comme avant les factures en francs) ; rien : `vide` (par défaut « 0,00 $ », l'ancien affichage).
 * `fmtUSD` : le formateur de dollars de l'écran appelant (pour qu'un total en dollars s'écrive
 * EXACTEMENT comme avant sur cet écran).
 */
export function libelleTotal(t: TotalDevises, vide?: string, fmtUSD: (n: number) => string = formaterUSD): string {
  const p = partsTotal(t);
  // Rien à additionner : un total de factures toutes en francs s'écrit « 0 FC », pas « 0,00 $ ».
  if (p.length === 0) return vide ?? (t.nbCDF > 0 && t.nbUSD === 0 ? formaterMontantFacture(0, "CDF") : fmtUSD(0));
  return p.map((x) => (x.devise === "USD" ? fmtUSD(x.montant) : formaterMontantFacture(x.montant, "CDF"))).join(" + ");
}

/** Le total compte-t-il des francs ? (l'équivalent unique en dollars est alors approché). */
export const aDesFrancs = (t: TotalDevises) => Math.abs(t.cdf) >= 0.005;

/**
 * Équivalent UNIQUE en dollars d'un total, quand un seul chiffre est nécessaire : dollars + francs ÷
 * taux du jour, au centime, `approx` dès qu'il y a des francs (« ≈ »). `null` s'il y a des francs et
 * pas de taux (« — », jamais 0). Sans francs : le total en dollars EXACT.
 */
export function equivalentUSD(t: TotalDevises, taux: number | null | undefined): { valeur: number; approx: boolean } | null {
  if (!aDesFrancs(t)) return { valeur: t.usd, approx: false };
  const tx = tauxUtilisable(taux);
  if (tx === null) return null;
  return { valeur: arr2(t.usd + t.cdf / tx), approx: true };
}

/** « ≈ 2 234,50 $ au taux du jour » / « ≈ — (taux du jour non défini) » ; null quand le total n'a pas de francs. */
export function libelleEquivalent(t: TotalDevises, taux: number | null | undefined): string | null {
  if (!aDesFrancs(t)) return null;
  const e = equivalentUSD(t, taux);
  return e === null ? "≈ — $ (taux du jour non défini)" : `≈ ${formaterUSD(e.valeur)} au taux du jour`;
}

/**
 * L'autre devise d'un montant de facture, au taux du jour : « ≈ 100,00 $ » pour 280 000 FC,
 * « ≈ 280 000 FC » pour 100 $ ; « ≈ — » sans taux.
 */
export function libelleAutreDevise(n: number, devise: DeviseFacture, taux: number | null | undefined): string {
  const tx = tauxUtilisable(taux);
  if (tx === null) return "≈ —";
  return devise === "CDF" ? `≈ ${formaterUSD(arr2(n / tx))}` : `≈ ${formaterMontantFacture(Math.round(n * tx), "CDF")}`;
}

/**
 * Somme d'un agrégat de factures, dollars et francs à part (`null` = aucune facture dans cette
 * devise). Sans francs : `fmtUSD(usd)` — EXACTEMENT l'affichage d'avant (y compris « — » pour null).
 * Avec : « 1 234,50 $ + 2 800 000 FC » ou « 2 800 000 FC » seul.
 */
export function libelleSomme(usd: number | null, cdf: number | null | undefined, fmtUSD: (n: number | null) => string): string {
  if (cdf === null || cdf === undefined || Math.abs(cdf) < 0.005) return fmtUSD(usd);
  const fc = formaterMontantFacture(cdf, "CDF");
  return usd === null || Math.abs(usd) < 0.005 ? fc : `${fmtUSD(usd)} + ${fc}`;
}

/** « ≈ 2 234,50 $ au taux du jour » pour une somme qui compte des francs ; null sinon (affichage d'avant). */
export const equivalentSomme = (usd: number | null, cdf: number | null | undefined, taux: number | null | undefined): string | null =>
  libelleEquivalent(totalDepuisSommes(usd, cdf ?? null), taux);
