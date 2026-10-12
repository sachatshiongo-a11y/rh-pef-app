// LA FICHE SALARIÉ SUR PLUSIEURS ANNÉES (demande de la Direction, 2026-10-12 : « les mini onglets congé et
// paie doivent être pensés sur plusieurs années »). Module PUR (ni base, ni React) : le choix de l'année
// (`?annee=`), les totaux annuels de l'historique de paie et l'ancien paramètre de l'onglet « Fin de
// contrat » (fondu dans « Contrats »). Les bilans de congé, eux, viennent de `solde-conge-salarie.ts` :
// rien n'est recalculé ici.

import { salaireNetCDF, salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";

/** L'année demandée dans l'adresse (`?annee=2025`), ou « toutes » (paie seulement). */
export type AnneeVue = number | "toutes";

export const PARAM_ANNEE = "annee";

const premier = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/**
 * `?annee=` brut → année affichée. Une valeur absente, illisible ou qui ne figure pas parmi les années de la
 * fiche retombe sur `defaut` (l'année en cours) : une adresse périmée ne mène jamais à un écran vide
 * inexpliqué. « toutes » n'est admis que si l'écran le propose (`avecToutes`).
 */
export function lireAnneeFiche(param: unknown, disponibles: readonly number[], defaut: number, avecToutes = false): AnneeVue {
  const s = premier(param);
  if (avecToutes && s === "toutes") return "toutes";
  const n = typeof s === "string" && /^\d{4}$/.test(s) ? Number(s) : NaN;
  return disponibles.includes(n) ? n : defaut;
}

/** Adresse d'un onglet de la fiche à une année donnée. Le changement d'année repart à la première page. */
export function lienFicheAnnee(employeeId: string, tab: string, annee: AnneeVue): string {
  return `/employes/${employeeId}?tab=${tab}&${PARAM_ANNEE}=${annee}`;
}

/** Années à proposer, de la plus récente à la plus ancienne : celles qui portent des données, et toujours l'année en cours. */
export function anneesAvecDonnees(annees: readonly number[], courante: number): number[] {
  return [...new Set([...annees, courante])].sort((a, b) => b - a);
}

/** Années de l'onglet Congés : celles du bilan (depuis l'embauche), celles que touchent les demandes, et l'année en cours. */
export function anneesDeConges(bilans: readonly { annee: number }[], demandes: readonly { dateDebut: Date; dateFin: Date }[], courante: number): number[] {
  return anneesAvecDonnees(
    [...bilans.map((b) => b.annee), ...demandes.flatMap((d) => [new Date(d.dateDebut).getUTCFullYear(), new Date(d.dateFin).getUTCFullYear()])],
    courante,
  );
}

/**
 * ANCIEN ONGLET « FIN DE CONTRAT » (décision V12 du plan d'ergonomie) : il est devenu une section de
 * l'onglet « Contrats ». Les liens, favoris et notifications qui portaient `?tab=fin` (ou `fin-contrat`)
 * sont redirigés vers l'ancre de la section. `null` : l'onglet demandé existe, rien à rediriger.
 */
export function redirectionAncienOnglet(tab: string | undefined): string | null {
  return tab === "fin" || tab === "fin-contrat" ? "tab=contrats#fin-de-contrat" : null;
}

// ─── Totaux annuels de l'historique de paie ────────────────────────────────────────────────────────

export type LigneTotauxPaie = {
  statutPaiement: "PAS_VALIDE" | "VALIDE" | "PAYE";
  /** Total versé stocké (net + transport), en dollars. */
  salNetUSD: number;
  transportUSD: number;
  /** Taux du bulletin (`tauxDeLigne`) ; 0 ou absent = inconnu. */
  taux: number;
};

export type TotauxAnnuelsPaie = {
  payes: number;
  valides: number;
  nonValides: number;
  /** Bulletins additionnés : validés ou payés. Un bulletin non validé est PROVISOIRE (le recalcul du mois le
   *  réécrit) : il ne s'additionne pas à des montants figés. */
  comptes: number;
  /** « null » = inconnu → l'écran affiche « — », jamais 0. */
  netUSD: number | null;
  netCDF: number | null;
  verseUSD: number | null;
};

const auCentime = (x: number) => Math.round(x * 100) / 100;

/**
 * Totaux d'une année : chaque montant n'est additionné que dans sa propre devise (dollars avec dollars,
 * francs avec francs — chaque ligne convertie à SON taux, arrondie au franc comme à l'écran, pour que le
 * total soit la somme de ce que la colonne affiche). Aucun bulletin validé ou payé = « — » ; un taux inconnu
 * sur l'un d'eux rend le total en francs inconnu (« — »), on ne le complète pas avec un autre taux.
 */
export function totauxAnnuelsPaie(lignes: readonly LigneTotauxPaie[]): TotauxAnnuelsPaie {
  const payes = lignes.filter((l) => l.statutPaiement === "PAYE").length;
  const valides = lignes.filter((l) => l.statutPaiement === "VALIDE").length;
  const nonValides = lignes.filter((l) => l.statutPaiement === "PAS_VALIDE").length;
  const figees = lignes.filter((l) => l.statutPaiement !== "PAS_VALIDE");
  if (figees.length === 0) return { payes, valides, nonValides, comptes: 0, netUSD: null, netCDF: null, verseUSD: null };
  const tauxConnus = figees.every((l) => Number.isFinite(l.taux) && l.taux > 0);
  return {
    payes,
    valides,
    nonValides,
    comptes: figees.length,
    netUSD: auCentime(figees.reduce((s, l) => s + salaireNetUSD(l), 0)),
    netCDF: tauxConnus ? figees.reduce((s, l) => s + Math.round(salaireNetCDF(l, l.taux)), 0) : null,
    verseUSD: auCentime(figees.reduce((s, l) => s + totalVerseUSD(l), 0)),
  };
}
