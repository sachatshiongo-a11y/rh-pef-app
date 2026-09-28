import Decimal from "decimal.js";
import { convertirVersUniteArticle } from "@/lib/fiches/disponibilite";
import { formaterNombre } from "@/lib/montant";
import { consommationReelle, MOTIF_LIVRAISON_RESTAURANT, type ConsommationReelle, type EntreesStockResto } from "@/lib/stock-restaurant";

// Conso. journalière (onglets Consommation et Comparaison) : fonctions PURES partagées par l'écran
// et ses exports PDF / Excel. Rien n'est écrit ; « — » pour l'inconnu, jamais 0.

const D = Decimal.clone({ precision: 60 });

export type LigneJours = { id: string; designation: string; jours: number[]; total: number };
export type SortieJournaliere = { articleId: string; designation: string; date: string; quantite: number; categorieSortie: string | null };

/**
 * Sorties du dépôt de la semaine, par article × jour, séparées par motif (décision de la Direction
 * du 2026-09-28) : « Livraison restaurant » (alimente le restaurant), « Perte » (reste au dépôt),
 * et sans motif (anciennes sorties importées, ou saisies sans motif) — annoncées à part, jamais
 * rangées d'office dans l'une ou l'autre.
 */
export function sortiesParMotif(sorties: SortieJournaliere[], jours: string[]): { livraisons: LigneJours[]; pertes: LigneJours[]; sansMotif: LigneJours[] } {
  const groupes = { livraisons: new Map<string, LigneJours>(), pertes: new Map<string, LigneJours>(), sansMotif: new Map<string, LigneJours>() };
  for (const s of sorties) {
    const i = jours.indexOf(s.date);
    if (i < 0) continue;
    const g = s.categorieSortie === MOTIF_LIVRAISON_RESTAURANT ? groupes.livraisons : s.categorieSortie === "PERTE" ? groupes.pertes : groupes.sansMotif;
    const l = g.get(s.articleId) ?? { id: s.articleId, designation: s.designation, jours: jours.map(() => 0), total: 0 };
    l.jours[i] += s.quantite;
    l.total += s.quantite;
    g.set(s.articleId, l);
  }
  const trier = (m: Map<string, LigneJours>) => [...m.values()].sort((a, b) => a.designation.localeCompare(b.designation, "fr"));
  return { livraisons: trier(groupes.livraisons), pertes: trier(groupes.pertes), sansMotif: trier(groupes.sansMotif) };
}

export type LigneConso = { id: string; designation: string; unite: string | null; espace: "CUISINE" | "BAR"; jours: ConsommationReelle[] };

/** Consommation réelle, par article du restaurant compté au moins une fois dans la semaine. */
export function consommationsSemaine(e: EntreesStockResto, jours: string[], espace?: "CUISINE" | "BAR"): LigneConso[] {
  const comptes = new Set(e.comptages.filter((c) => jours.includes(c.date)).map((c) => c.articleRestoId));
  return e.articles
    .filter((a) => comptes.has(a.id) && (!espace || a.espace === espace))
    .sort((a, b) => a.designation.localeCompare(b.designation, "fr"))
    .map((a) => ({ id: a.id, designation: a.designation, unite: a.unite, espace: a.espace, jours: jours.map((j) => consommationReelle(e, a.id, j)) }));
}

/** « 1 500 », « -300 » (quantité, pas un montant) ; « — » quand la consommation est inconnue. */
export function texteConso(c: ConsommationReelle): string {
  return c.etat === "CONNUE" ? formaterNombre(Number(c.quantite), { maximumFractionDigits: 3 }) : "—";
}

/**
 * Consommation réelle par article du CATALOGUE, jour par jour, dans l'unité du catalogue (pour la
 * mettre à côté du commandé et du livré). Somme des articles du restaurant rattachés ; null (« — »)
 * dès que l'un d'eux est inconnu ce jour-là ou d'unité non convertible — jamais une somme partielle.
 */
export function consommationParArticleCatalogue(e: EntreesStockResto, jours: string[]): Map<string, (string | null)[]> {
  const res = new Map<string, (string | null)[]>();
  const parCatalogue = new Map<string, typeof e.articles>();
  for (const a of e.articles) if (a.articleStockId) parCatalogue.set(a.articleStockId, [...(parCatalogue.get(a.articleStockId) ?? []), a]);
  for (const [cat, restos] of parCatalogue) {
    res.set(cat, jours.map((j) => {
      let total = new D(0);
      for (const r of restos) {
        const c = consommationReelle(e, r.id, j);
        if (c.etat !== "CONNUE") return null;
        const converti = convertirVersUniteArticle(c.quantite, r.unite ?? "", r.uniteCatalogue ?? "");
        if (converti === null) return null;
        total = total.plus(converti);
      }
      return total.toString();
    }));
  }
  return res;
}

export type EcartJour = "LIVRE_NON_CONSOMME" | "CONSOMME_PLUS_QUE_LIVRE";
export const LIBELLE_ECART: Record<EcartJour, string> = {
  LIVRE_NON_CONSOMME: "livré non consommé",
  CONSOMME_PLUS_QUE_LIVRE: "consommé plus que livré",
};

/** Écart du jour entre livré et consommé ; null si égal ou si le consommé est inconnu. */
export function ecartJour(livre: number, consomme: string | null): EcartJour | null {
  if (consomme === null) return null;
  const c = new D(consomme);
  const l = new D(livre);
  if (l.greaterThan(c)) return "LIVRE_NON_CONSOMME";
  if (c.greaterThan(l)) return "CONSOMME_PLUS_QUE_LIVRE";
  return null;
}

// ─── Export (PDF / Excel) de l'onglet Consommation ───────────────────────────

export type RoleCol = "cmd" | "liv" | "conso" | null;

export const SECTION_LIVRE = "Livré au restaurant (sorties « Livraison restaurant »)";
export const SECTION_PERTES = "Pertes (restent au dépôt)";
export const SECTION_SANS_MOTIF = "Sorties sans motif";
export const SECTION_CONSO = "Consommation réelle au restaurant (comptages)";

/** Quantité d'export : vide pour 0 (grille lisible), sinon format français partagé. */
export const nbExport = (n: number) => (n ? formaterNombre(Math.round(n * 1000) / 1000, { maximumFractionDigits: 3 }) : "");

/** Total d'une semaine de consommation : seulement si TOUS les jours sont connus, sinon « — ». */
export function totalConso(jours: ConsommationReelle[]): string {
  let somme = new D(0);
  for (const j of jours) {
    if (j.etat !== "CONNUE") return "—";
    somme = somme.plus(j.quantite);
  }
  return formaterNombre(somme.toNumber(), { maximumFractionDigits: 3 });
}

/** Cellule de consommation : « — » si inconnue ; « -300 (écart) » si négative (plus compté que reçu). */
const celluleConso = (c: ConsommationReelle) => (c.etat === "CONNUE" && c.negative ? `${texteConso(c)} (écart)` : texteConso(c));

/**
 * Lignes de l'export de l'onglet Consommation : livré au restaurant, pertes, sorties sans motif,
 * légumes frais, puis consommation réelle. `rolesLignes` colore chaque ligne selon ce qu'elle dit.
 * Le total d'une consommation n'existe que si tous les jours sont connus (jamais un total partiel).
 */
export function lignesExportConso(p: {
  sorties: ReturnType<typeof sortiesParMotif>;
  legumes: { nom: string; jours: number[] }[];
  consoResto: LigneConso[];
}): { lignes: string[][]; sectionRows: number[]; rolesLignes: Record<number, RoleCol> } {
  const lignes: string[][] = [];
  const sectionRows: number[] = [];
  const rolesLignes: Record<number, RoleCol> = {};
  const section = (titre: string) => { sectionRows.push(lignes.length); lignes.push([titre]); };
  const ligne = (cells: string[], role: RoleCol) => { rolesLignes[lignes.length] = role; lignes.push(cells); };
  const bloc = (titre: string, rows: LigneJours[], role: RoleCol) => {
    if (rows.length === 0) return;
    section(titre);
    for (const r of rows) ligne([r.designation, ...r.jours.map(nbExport), nbExport(r.total)], role);
  };
  bloc(SECTION_LIVRE, p.sorties.livraisons, "liv");
  bloc(SECTION_PERTES, p.sorties.pertes, null);
  bloc(SECTION_SANS_MOTIF, p.sorties.sansMotif, null);
  if (p.legumes.length > 0) {
    section("Légumes frais (achats du jour)");
    for (const l of p.legumes) ligne([l.nom, ...l.jours.map(nbExport), nbExport(l.jours.reduce((a, b) => a + b, 0))], "liv");
  }
  if (p.consoResto.length > 0) {
    section(SECTION_CONSO);
    for (const c of p.consoResto) {
      ligne([`${c.designation}${c.unite ? ` (${c.unite})` : ""}`, ...c.jours.map(celluleConso), totalConso(c.jours)], "conso");
    }
  }
  return { lignes, sectionRows, rolesLignes };
}
