// MOUVEMENTS D'UN ARTICLE CLASSÉS PAR ANNÉE ET PAR MOIS (demande de la Direction, 2026-10-12 : « pouvoir classer les
// entrées et les sorties en fonction des mois et des années, avec la consommation totale du mois »).
//
// Module PUR (ni base, ni React). La page lit UN agrégat de la base (jour × type × motif, quantités et nombres) et tout
// le reste en découle ici : les années proposées, les mois, les effectifs des pastilles, les totaux d'un mois ET la
// carte « Consommation du mois » du haut de la fiche — la MÊME fonction (`consommationDuMois`), donc la même règle.
//
// RÈGLE DE LA CONSOMMATION (celle de la carte d'origine, inchangée) : TOUTES les sorties du mois, quel que soit leur
// motif — livraison restaurant, perte, sans motif (écarts d'un import d'inventaire compris). Les pertes y sont
// comprises et dites à part. Les entrées et les ajustements n'y comptent pas. Les ajustements (son sens n'est pas
// enregistré) ne comptent ni en entrée ni en sortie.
//
// MOIS : la colonne `MouvementStock.date` est une date PURE (`@db.Date`, minuit UTC du jour civil de Kinshasa, écrite
// avec `jourCivilKinshasa`) : son mois se lit en UTC. Le mois « en cours » vient de l'horloge de Kinshasa.

import { anneeCouranteKinshasa, numeroMoisCourantKinshasa } from "@/lib/heure-kinshasa";
import type { FiltreMouvements } from "@/lib/fiche-article";

/** Un groupe de mouvements d'un article : un jour, un type, un motif — avec leur nombre et leur quantité totale. */
export type AgregatMouvement = {
  date: Date | string;
  type: string;
  categorieSortie: string | null;
  nb: number;
  quantite: number;
};

/** Le périmètre choisi : une année (ou toutes) et, dans une année, un mois (1 à 12) ou tous les mois. */
export type PeriodeMouvements = { annee: number | "toutes"; mois: number | null };

const premier = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Année et mois (1 à 12) d'une date pure. */
export function anneeMoisDe(date: Date | string): { annee: number; mois: number } {
  const d = new Date(date);
  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1 };
}

/** Le mois civil de Kinshasa en cours (le mois de la carte « Consommation du mois »). */
export function moisEnCours(maintenant: Date = new Date()): { annee: number; mois: number } {
  return { annee: anneeCouranteKinshasa(maintenant), mois: numeroMoisCourantKinshasa(maintenant) };
}

/** Années qui portent des mouvements (de la plus récente à la plus ancienne), sans l'année en cours (à ajouter par l'appelant). */
export function anneesDesMouvements(agregats: readonly AgregatMouvement[]): number[] {
  return [...new Set(agregats.map((g) => anneeMoisDe(g.date).annee))].sort((a, b) => b - a);
}

/** Mois (1 à 12) d'une année qui portent des mouvements, du plus récent au plus ancien. */
export function moisAvecMouvements(agregats: readonly AgregatMouvement[], annee: number): number[] {
  return [...new Set(agregats.map((g) => anneeMoisDe(g.date)).filter((x) => x.annee === annee).map((x) => x.mois))].sort((a, b) => b - a);
}

/** `?mois=` brut → mois (1 à 12) s'il porte des mouvements dans l'année choisie ; sinon « tous les mois » (null). */
export function lireMoisMouvements(param: unknown, disponibles: readonly number[]): number | null {
  const s = premier(param);
  const n = typeof s === "string" && /^\d{1,2}$/.test(s) ? Number(s) : NaN;
  return disponibles.includes(n) ? n : null;
}

const dansLaPeriode = (g: AgregatMouvement, p: PeriodeMouvements): boolean => {
  if (p.annee === "toutes") return true;
  const { annee, mois } = anneeMoisDe(g.date);
  return annee === p.annee && (p.mois === null || mois === p.mois);
};

/** Effectifs des pastilles de type (Entrées / Sorties / Ajustements / Tous) dans la période choisie. */
export function effectifsPeriode(agregats: readonly AgregatMouvement[], periode: PeriodeMouvements): Record<FiltreMouvements, number> {
  const e: Record<FiltreMouvements, number> = { entrees: 0, sorties: 0, ajustements: 0, tous: 0 };
  for (const g of agregats) {
    if (!dansLaPeriode(g, periode)) continue;
    e.tous += g.nb;
    if (g.type === "ENTREE") e.entrees += g.nb;
    else if (g.type === "SORTIE") e.sorties += g.nb;
    else if (g.type === "AJUSTEMENT") e.ajustements += g.nb;
  }
  return e;
}

/** Nombre de mouvements d'un mois pour un filtre de type (pour dire qu'une page est partielle). */
export function nbDuMois(agregats: readonly AgregatMouvement[], annee: number, mois: number, filtre: FiltreMouvements): number {
  return effectifsPeriode(agregats, { annee, mois })[filtre];
}

/** Années proposées par les pastilles : celles qui portent des mouvements, plus l'année en cours. */
export function effectifsParAnnee(agregats: readonly AgregatMouvement[], annees: readonly number[]): Record<string, number> {
  const e: Record<string, number> = { toutes: agregats.reduce((n, g) => n + g.nb, 0) };
  for (const a of annees) e[String(a)] = effectifsPeriode(agregats, { annee: a, mois: null }).tous;
  return e;
}

export type ConsommationMois = {
  /** Toutes les sorties du mois, pertes comprises. */
  total: number;
  /** Part des pertes (motif PERTE), dite à part. */
  pertes: number;
};

/**
 * LA consommation d'un mois — la seule définition, partagée par la carte « Consommation du mois » du haut de la fiche
 * et par l'en-tête de chaque mois de l'onglet Mouvements : toutes les sorties du mois, quel que soit le motif.
 */
export function consommationDuMois(agregats: readonly AgregatMouvement[], annee: number, mois: number): ConsommationMois {
  let total = 0, pertes = 0;
  for (const g of agregats) {
    if (g.type !== "SORTIE") continue;
    const m = anneeMoisDe(g.date);
    if (m.annee !== annee || m.mois !== mois) continue;
    total += g.quantite;
    if (g.categorieSortie === "PERTE") pertes += g.quantite;
  }
  return { total, pertes };
}

export type TotauxMois = { entrees: number; sorties: number; consommation: ConsommationMois; nb: number };

/** Totaux d'un mois ENTIER (jamais ceux de la page affichée) : entrées, sorties, consommation. */
export function totauxDuMois(agregats: readonly AgregatMouvement[], annee: number, mois: number): TotauxMois {
  let entrees = 0, nb = 0;
  for (const g of agregats) {
    const m = anneeMoisDe(g.date);
    if (m.annee !== annee || m.mois !== mois) continue;
    nb += g.nb;
    if (g.type === "ENTREE") entrees += g.quantite;
  }
  const consommation = consommationDuMois(agregats, annee, mois);
  return { entrees, sorties: consommation.total, consommation, nb };
}

/** Bornes de la période pour la requête (`date >= gte` et `date < lt`) ; null = pas de borne (« Toutes »). */
export function bornesPeriode(periode: PeriodeMouvements): { gte: Date; lt: Date } | null {
  if (periode.annee === "toutes") return null;
  const debut = periode.mois === null ? Date.UTC(periode.annee, 0, 1) : Date.UTC(periode.annee, periode.mois - 1, 1);
  const fin = periode.mois === null ? Date.UTC(periode.annee + 1, 0, 1) : Date.UTC(periode.annee, periode.mois, 1);
  return { gte: new Date(debut), lt: new Date(fin) };
}

/** « Octobre 2026 » (majuscule initiale). */
export function libelleMoisAnnee(annee: number, mois: number): string {
  const t = new Date(Date.UTC(annee, mois - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** « Octobre » (majuscule initiale) — libellé d'une pastille de mois. */
export function libelleMois(mois: number): string {
  const t = new Date(Date.UTC(2000, mois - 1, 1)).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Regroupe des mouvements (déjà triés du plus récent au plus ancien) par mois, dans le même ordre. */
export function groupesParMois<T extends { date: Date | string }>(lignes: readonly T[]): { annee: number; mois: number; lignes: T[] }[] {
  const groupes: { annee: number; mois: number; lignes: T[] }[] = [];
  for (const l of lignes) {
    const { annee, mois } = anneeMoisDe(l.date);
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.annee === annee && dernier.mois === mois) dernier.lignes.push(l);
    else groupes.push({ annee, mois, lignes: [l] });
  }
  return groupes;
}

/** Adresse de l'export PDF de l'article, qui suit la période et le type choisis. */
export function lienPdfArticle(articleId: string, periode: PeriodeMouvements, filtre: FiltreMouvements): string {
  const p = new URLSearchParams({ annee: String(periode.annee) });
  if (periode.annee !== "toutes" && periode.mois !== null) p.set("mois", String(periode.mois));
  if (filtre !== "tous") p.set("filtre", filtre);
  return `/stock/catalogue/${articleId}/pdf?${p}`;
}

/** Lecture de `?annee=` / `?mois=` / `?filtre=` d'une requête (route PDF) : valeur illisible → pas de période. */
export function periodeDeRequete(params: URLSearchParams): PeriodeMouvements | null {
  const a = params.get("annee");
  if (a === null) return null;
  if (a === "toutes") return { annee: "toutes", mois: null };
  if (!/^\d{4}$/.test(a)) return null;
  const n = Number(a);
  const m = params.get("mois");
  const mois = m !== null && /^\d{1,2}$/.test(m) && Number(m) >= 1 && Number(m) <= 12 ? Number(m) : null;
  return { annee: n, mois };
}
