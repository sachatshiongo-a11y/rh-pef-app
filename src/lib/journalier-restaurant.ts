import Decimal from "decimal.js";
import { convertirVersUniteArticle } from "@/lib/fiches/disponibilite";
import { formaterNombre } from "@/lib/montant";
import type { Colonne } from "@/lib/pdf/tableau";
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
    .map((a) => ({ id: a.id, designation: a.inactif ? `${a.designation} (désactivé)` : a.designation, unite: a.unite, espace: a.espace, jours: jours.map((j) => consommationReelle(e, a.id, j)) }));
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

// ─── Onglet Comparaison ──────────────────────────────────────────────────────

export type LigneComparaison = {
  id: string; designation: string; categorie: string;
  /** Article du catalogue (nom cliquable vers sa fiche) ; faux pour un légume frais. */
  lien: boolean;
  cmd: number[];
  /** Livré au restaurant (motif « Livraison restaurant » seulement ; achats du jour pour un légume). */
  liv: number[];
  /** Consommé au restaurant, unité du catalogue ; null = « — ». */
  conso: (string | null)[];
  ecarts: (EcartJour | null)[];
};

/**
 * Lignes de la comparaison commandé / livré / consommé, par article du catalogue (+ légumes frais).
 * Un article n'apparaît que s'il a été commandé, livré ou consommé dans la semaine.
 */
export function lignesComparaison(p: {
  jours: string[];
  articles: { id: string; designation: string; categorie: string }[];
  commandes: Record<string, number>;
  livraisons: LigneJours[];
  consoParArticle: Map<string, (string | null)[]>;
  /** Sans filtre de domaine : les articles livrés hors de la liste (autre domaine, inactifs) sont ajoutés. */
  inclureHorsCatalogue: boolean;
  legumes?: { nom: string; cmd: number[]; liv: number[] }[];
}): LigneComparaison[] {
  const vide = p.jours.map(() => 0);
  const inconnu = p.jours.map(() => null);
  const livParId = new Map(p.livraisons.map((l) => [l.id, l]));
  const lignes: LigneComparaison[] = [];
  const pousser = (l: Omit<LigneComparaison, "ecarts">) => {
    if (l.cmd.some((v) => v > 0) || l.liv.some((v) => v > 0) || l.conso.some((v) => v !== null)) {
      lignes.push({ ...l, ecarts: l.liv.map((v, i) => ecartJour(v, l.conso[i] ?? null)) });
    }
  };
  const vus = new Set<string>();
  for (const a of p.articles) {
    vus.add(a.id);
    pousser({
      id: a.id, designation: a.designation, categorie: a.categorie, lien: true,
      cmd: p.jours.map((j) => p.commandes[`${a.id}_${j}`] ?? 0),
      liv: livParId.get(a.id)?.jours ?? vide,
      conso: p.consoParArticle.get(a.id) ?? inconnu,
    });
  }
  if (p.inclureHorsCatalogue) {
    for (const l of p.livraisons) {
      if (vus.has(l.id)) continue;
      pousser({ id: l.id, designation: l.designation, categorie: "À classer", lien: true, cmd: vide, liv: l.jours, conso: p.consoParArticle.get(l.id) ?? inconnu });
    }
  }
  for (const g of p.legumes ?? []) pousser({ id: `legume:${g.nom}`, designation: g.nom, categorie: "Légumes frais", lien: false, cmd: g.cmd, liv: g.liv, conso: inconnu });
  return lignes.sort((a, b) => a.categorie.localeCompare(b.categorie, "fr") || a.designation.localeCompare(b.designation, "fr"));
}

const texteQte = (v: string | null) => (v === null ? "—" : formaterNombre(Number(v), { maximumFractionDigits: 3 }));

/**
 * Export (PDF / Excel) de la comparaison : par jour, commandé / livré / consommé ; puis les totaux.
 * Le total consommé n'existe que si chaque jour est connu. `ecarts` : cellules « r:c » du consommé
 * en écart avec le livré (à colorer).
 */
export function lignesExportComparaison(lignesComp: LigneComparaison[], labels: string[]): {
  lignes: string[][]; sectionRows: number[]; entete: string[]; colRole: RoleCol[]; ecarts: Set<string>; colonnes: Colonne[];
} {
  const lignes: string[][] = [];
  const sectionRows: number[] = [];
  const ecarts = new Set<string>();
  let categorie: string | null = null;
  for (const l of lignesComp) {
    if (l.categorie !== categorie) { sectionRows.push(lignes.length); lignes.push([l.categorie]); categorie = l.categorie; }
    const cells = [l.designation];
    labels.forEach((_, i) => {
      if (l.ecarts[i]) ecarts.add(`${lignes.length}:${cells.length + 2}`);
      cells.push(nbExport(l.cmd[i]!), nbExport(l.liv[i]!), texteQte(l.conso[i] ?? null));
    });
    const totalConsomme = l.conso.every((v) => v !== null) ? l.conso.reduce((t, v) => t.plus(v!), new D(0)).toString() : null;
    cells.push(nbExport(l.cmd.reduce((a, b) => a + b, 0)), nbExport(l.liv.reduce((a, b) => a + b, 0)), texteQte(totalConsomme));
    lignes.push(cells);
  }
  const entete = ["Article", ...labels.flatMap((l) => [`${l} Cmd`, `${l} Liv`, `${l} Conso`]), "Total Cmd", "Total Liv", "Total Conso"];
  const colRole: RoleCol[] = [null, ...[...labels, "total"].flatMap(() => ["cmd", "liv", "conso"] as RoleCol[])];
  const colW = `${84 / ((labels.length + 1) * 3)}%`;
  const colonnes: Colonne[] = [
    { header: "Article", width: "16%" },
    ...[...labels, "Tot."].flatMap((l) => [
      { header: `${l} C`, width: colW, align: "right" as const },
      { header: `${l} L`, width: colW, align: "right" as const },
      { header: `${l} Cs`, width: colW, align: "right" as const },
    ]),
  ];
  return { lignes, sectionRows, entete, colRole, ecarts, colonnes };
}

/**
 * PDF de la comparaison : 25 colonnes ne tiennent pas lisiblement sur une page (constaté au rendu :
 * « 1 180,125 » se coupait sur deux lignes). Deux parties, chacune sur sa page paysage : lundi à jeudi,
 * puis vendredi à dimanche et les totaux. `indices` : colonnes de l'export reprises dans la partie.
 */
export function partiesPdfComparaison(labels: string[]): { titre: string; indices: number[]; colonnes: Colonne[] }[] {
  const coupe = Math.ceil(labels.length / 2 + 0.5); // 7 jours : 4 + 3 (+ totaux)
  const groupes = [
    // « à » et non « → » : la flèche n'existe pas dans Optima, la police des PDF (elle sortait en « ’ »).
    { titre: `${labels[0]} à ${labels[coupe - 1]}`, jours: labels.slice(0, coupe).map((l, i) => ({ l, i })) },
    { titre: `${labels[coupe]} à ${labels[labels.length - 1]}, et totaux de la semaine`, jours: [...labels.slice(coupe).map((l, i) => ({ l, i: coupe + i })), { l: "Tot.", i: labels.length }] },
  ];
  return groupes.map((g) => {
    const largeur = `${84 / (g.jours.length * 3)}%`;
    return {
      titre: g.titre,
      indices: [0, ...g.jours.flatMap(({ i }) => [1 + i * 3, 2 + i * 3, 3 + i * 3])],
      colonnes: [
        { header: "Article", width: "16%" },
        ...g.jours.flatMap(({ l }) => [
          { header: `${l} C`, width: largeur, align: "right" as const },
          { header: `${l} L`, width: largeur, align: "right" as const },
          { header: `${l} Cs`, width: largeur, align: "right" as const },
        ]),
      ],
    };
  });
}
