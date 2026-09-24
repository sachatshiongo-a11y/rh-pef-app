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

/** Gains d'une ligne, tels que stockés (ou tels que le moteur les rend). */
export type LigneGains = LigneNet & {
  remuneration100: Montant;
  remuneration2_3: Montant;
  hsValorisee: Montant;
  primesUSD: Montant;
  salBrutUSD: Montant;
};

/**
 * Salaire de base (part à 100 %) à AFFICHER. Depuis le 2026-09-24, le moteur le porte pour tous
 * (`remuneration100`, au centime). Avant, une ligne BACK-OFFICE stockait 0 et le bulletin imprimait
 * « Salaire de base 0,00 $ » sous un brut imposable positif. Pour ces lignes figées (jamais
 * réécrites), la base affichée est ce que le brut contient d'autre que le transport, les primes,
 * les heures supplémentaires et l'indemnité maladie — les lignes du bulletin s'additionnent alors
 * au brut stocké. Une ligne brigade garde toujours son montant stocké.
 */
export function salaireDeBaseUSD(l: LigneGains, categorie: string): number {
  const r100 = n(l.remuneration100);
  if (categorie === "BRIGADE" || r100 !== 0) return r100;
  const reste = n(l.salBrutUSD) - n(l.transportUSD) - n(l.primesUSD) - n(l.hsValorisee) - n(l.remuneration2_3);
  return Math.round(reste * 100) / 100;
}
