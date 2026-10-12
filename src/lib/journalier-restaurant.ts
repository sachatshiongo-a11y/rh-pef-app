import Decimal from "decimal.js";
import { convertirVersUniteArticle } from "@/lib/fiches/disponibilite";
import { formaterNombre } from "@/lib/montant";
import type { Colonne } from "@/lib/pdf/tableau";
import { normaliserUnite } from "@/lib/fiches/conversion";
import { articleCatalogueLie, consoApproximative, consommationReelle, mentionDepuis, MOTIF_LIVRAISON_RESTAURANT, type ConsommationReelle, type EntreesStockResto } from "@/lib/stock-restaurant";

// Conso. journalière (onglets Consommation et Comparaison) : fonctions PURES partagées par l'écran
// et ses exports PDF / Excel. Rien n'est écrit ; « — » pour l'inconnu, jamais 0.

const D = Decimal.clone({ precision: 60 });

/** `unite` : unité du catalogue de l'article (absente = non renseignée) — jamais additionnée à une autre. */
export type LigneJours = { id: string; designation: string; unite?: string | null; jours: number[]; total: number };
export type SortieJournaliere = { articleId: string; designation: string; unite?: string | null; date: string; quantite: number; categorieSortie: string | null };

/**
 * Somme EXACTE (décimale) de quantités : 0,1 + 0,2 = 0,3 et non 0,30000000000000004 — sans quoi un
 * livré de 0,3 « différait » d'un commandé de 0,3 (faux écart orange, audit 2026-10-10).
 */
export function sommeExacte(xs: readonly number[]): number {
  return xs.reduce((t, x) => t.plus(x), new D(0)).toNumber();
}

/** Désignation suivie de l'unité du catalogue : « Farine (kg) » ; sans unité renseignée, la désignation seule. */
export function libelleAvecUnite(designation: string, unite: string | null | undefined): string {
  const u = unite?.trim();
  return u ? `${designation} (${u})` : designation;
}

/** Total d'une unité : `unite` null = lignes dont l'unité n'est pas renseignée. */
export type TotalUnite = { unite: string | null; total: number };

/**
 * Totaux PAR UNITÉ : 12 kg et 5 bouteilles ne s'additionnent jamais en « 17 ». Les unités qui ne
 * diffèrent que par l'orthographe (« Kg », « kilos », « Bouteille(s) »…) sont la même (normalisation
 * unique de la conversion) ; l'écriture affichée est celle de la première rencontrée. Sommes exactes.
 */
export function totauxParUnite(items: readonly { unite?: string | null; valeur: number }[]): TotalUnite[] {
  const groupes = new Map<string, { unite: string | null; valeurs: number[] }>();
  for (const it of items) {
    const brute = it.unite?.trim() || null;
    const cle = brute === null ? "" : normaliserUnite(brute);
    const g = groupes.get(cle) ?? { unite: brute, valeurs: [] };
    g.valeurs.push(it.valeur);
    groupes.set(cle, g);
  }
  return [...groupes.values()].map((g) => ({ unite: g.unite, total: sommeExacte(g.valeurs) }));
}

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
    const l = g.get(s.articleId) ?? { id: s.articleId, designation: s.designation, ...(s.unite !== undefined ? { unite: s.unite } : {}), jours: jours.map(() => 0), total: 0 };
    // Sommes décimales exactes (0,1 + 0,2 = 0,3), jamais en flottant.
    l.jours[i] = sommeExacte([l.jours[i]!, s.quantite]);
    l.total = sommeExacte([l.total, s.quantite]);
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
 * Articles du restaurant rattachés à chaque article du catalogue. `partage` : l'un d'eux est rattaché à
 * PLUSIEURS articles du catalogue (plusieurs marques de beurre) — sa consommation ne se range pas sous
 * une marque plutôt qu'une autre : la comparaison par article du catalogue ne l'attribue à aucune (« — »),
 * elle se lit par article du restaurant (onglet Consommation).
 */
function restosParCatalogue(e: EntreesStockResto): Map<string, typeof e.articles> {
  const parCatalogue = new Map<string, typeof e.articles>();
  for (const a of e.articles) for (const l of a.rattaches) parCatalogue.set(l.id, [...(parCatalogue.get(l.id) ?? []), a]);
  return parCatalogue;
}
const consoPartagee = (restos: readonly { rattaches: readonly unknown[] }[]) => restos.some((r) => r.rattaches.length > 1);

/**
 * Consommation réelle par article du CATALOGUE, jour par jour, dans l'unité du catalogue (pour la
 * mettre à côté du commandé et du livré). Somme des articles du restaurant rattachés ; null (« — »)
 * dès que l'un d'eux est inconnu ce jour-là ou d'unité non convertible — jamais une somme partielle.
 */
export function consommationParArticleCatalogue(e: EntreesStockResto, jours: string[]): Map<string, (string | null)[]> {
  const res = new Map<string, (string | null)[]>();
  const parCatalogue = restosParCatalogue(e);
  for (const [cat, restos] of parCatalogue) {
    if (consoPartagee(restos)) { res.set(cat, jours.map(() => null)); continue; }
    res.set(cat, jours.map((j) => {
      let total = new D(0);
      for (const r of restos) {
        const c = consommationReelle(e, r.id, j);
        if (c.etat !== "CONNUE") return null;
        const converti = convertirVersUniteArticle(c.quantite, r.unite ?? "", articleCatalogueLie(r.rattaches.find((l) => l.id === cat)!));
        if (converti === null) return null;
        total = total.plus(converti);
      }
      return total.toString();
    }));
  }
  return res;
}

/**
 * Les jours dont la consommation par article du catalogue est APPROXIMATIVE (« ≈ ») : veille non
 * comptée (la consommation couvre plusieurs jours : « depuis le 12/10 (3 jours) ») ou estimée sans
 * comptage (""). null = exacte, ou inconnue. Même parcours que `consommationParArticleCatalogue`.
 */
export function consoApproximativeParArticleCatalogue(e: EntreesStockResto, jours: string[]): Map<string, (string | null)[]> {
  const res = new Map<string, (string | null)[]>();
  const parCatalogue = restosParCatalogue(e);
  for (const [cat, restos] of parCatalogue) {
    if (consoPartagee(restos)) { res.set(cat, jours.map(() => null)); continue; }
    res.set(cat, jours.map((j) => {
      let mention: string | null = null;
      for (const r of restos) {
        const c = consommationReelle(e, r.id, j);
        if (c.etat === "CONNUE" && consoApproximative(c)) mention = mention || mentionDepuis(c) || "";
      }
      return mention;
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

/** Nombre signé pour un écart : « +1,5 » / « -2 » (trait d'union ordinaire : le « − » manque à Optima). */
function texteSigne(d: Decimal): string | null {
  const arrondi = new D(d.toFixed(3));
  if (arrondi.isZero()) return null;
  return `${arrondi.isNegative() ? "-" : "+"}${formaterNombre(arrondi.abs().toNumber(), { maximumFractionDigits: 3 })}`;
}

/**
 * Écart signé du CONSOMMÉ par rapport au livré, pour doubler la couleur d'un signe (« -1 » : une
 * unité livrée n'a pas été consommée ; « +1,5 » : consommé en plus de ce qui a été livré).
 * Lit exactement la même règle que `ecartJour` : null quand il n'y a pas d'écart ou pas de comptage.
 */
export function ecartConsoLivre(livre: number, consomme: string | null): string | null {
  if (ecartJour(livre, consomme) === null) return null;
  return texteSigne(new D(consomme!).minus(new D(livre)));
}

/**
 * Livré ≠ commandé (l'un des deux au moins est renseigné) : la règle de l'orange de la Comparaison.
 * Comparaison DÉCIMALE à la précision de la base (3 décimales) : jamais un faux écart de flottant.
 */
export const livreDiffereDuCommande = (cmd: number, liv: number) =>
  !new D(cmd).toDecimalPlaces(3).equals(new D(liv).toDecimalPlaces(3)) && (cmd > 0 || liv > 0);

/** Écart signé du LIVRÉ par rapport au commandé (« +2 » : livré en plus) ; null s'il n'y a pas d'écart. */
export function ecartLivreCommande(cmd: number, liv: number): string | null {
  if (!livreDiffereDuCommande(cmd, liv)) return null;
  return texteSigne(new D(liv).minus(new D(cmd)));
}

/** Vrai si la ligne a au moins un écart dans la semaine (livré ≠ commandé, livré non consommé, consommé en trop). */
export function aUnEcart(l: LigneComparaison): boolean {
  return l.cmd.some((c, i) => livreDiffereDuCommande(c, l.liv[i] ?? 0)) || l.ecarts.some((e) => e !== null);
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
  let approx = false;
  for (const j of jours) {
    if (j.etat !== "CONNUE") return "—";
    somme = somme.plus(j.quantite);
    if (consoApproximative(j)) approx = true;
  }
  return `${approx ? "≈ " : ""}${formaterNombre(somme.toNumber(), { maximumFractionDigits: 3 })}`;
}

/**
 * Cellule de consommation : « — » si inconnue ; « -300 (écart) » si négative (plus compté que reçu) ;
 * « ≈ 120 depuis le 12/10 (3 jours) » quand la veille n'a pas été comptée (consommation de plusieurs
 * jours), « ≈ 120 » quand elle est estimée sans aucun comptage.
 */
const celluleConso = (c: ConsommationReelle) => {
  if (c.etat !== "CONNUE") return texteConso(c);
  const t = c.negative ? `${texteConso(c)} (écart)` : texteConso(c);
  if (!consoApproximative(c)) return t;
  const depuis = mentionDepuis(c);
  return `≈ ${t}${depuis ? ` ${depuis}` : ""}`;
};

/**
 * Lignes de l'export de l'onglet Consommation : livré au restaurant, pertes, sorties sans motif,
 * légumes frais, puis consommation réelle. `rolesLignes` colore chaque ligne selon ce qu'elle dit.
 * Le total d'une consommation n'existe que si tous les jours sont connus (jamais un total partiel).
 */
export function lignesExportConso(p: {
  sorties: ReturnType<typeof sortiesParMotif>;
  legumes: { nom: string; unite?: string | null; jours: number[] }[];
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
    for (const r of rows) ligne([libelleAvecUnite(r.designation, r.unite), ...r.jours.map(nbExport), nbExport(r.total)], role);
  };
  bloc(SECTION_LIVRE, p.sorties.livraisons, "liv");
  bloc(SECTION_PERTES, p.sorties.pertes, null);
  bloc(SECTION_SANS_MOTIF, p.sorties.sansMotif, null);
  if (p.legumes.length > 0) {
    section("Légumes frais (achats du jour)");
    for (const l of p.legumes) ligne([libelleAvecUnite(l.nom, l.unite), ...l.jours.map(nbExport), nbExport(sommeExacte(l.jours))], "liv");
  }
  if (p.consoResto.length > 0) {
    section(SECTION_CONSO);
    for (const c of p.consoResto) {
      ligne([libelleAvecUnite(c.designation, c.unite), ...c.jours.map(celluleConso), totalConso(c.jours)], "conso");
    }
  }
  return { lignes, sectionRows, rolesLignes };
}

// ─── Onglet Comparaison ──────────────────────────────────────────────────────

export type LigneComparaison = {
  id: string; designation: string; categorie: string;
  /** Unité du catalogue (ou de la liste des légumes) dans laquelle sont commandé, livré et consommé ; absente = non renseignée. */
  unite?: string | null;
  /** Article du catalogue (nom cliquable vers sa fiche) ; faux pour un légume frais. */
  lien: boolean;
  cmd: number[];
  /** Livré au restaurant (motif « Livraison restaurant » seulement ; achats du jour pour un légume). */
  liv: number[];
  /** Consommé au restaurant, unité du catalogue ; null = « — ». */
  conso: (string | null)[];
  /** Consommé approximatif (« ≈ ») : « depuis le 12/10 (3 jours) », "" si estimé sans comptage, null si exact. */
  consoApprox?: (string | null)[];
  ecarts: (EcartJour | null)[];
};

/**
 * Lignes de la comparaison commandé / livré / consommé, par article du catalogue (+ légumes frais).
 * Un article n'apparaît que s'il a été commandé, livré ou consommé dans la semaine.
 */
export function lignesComparaison(p: {
  jours: string[];
  articles: { id: string; designation: string; categorie: string; unite?: string | null }[];
  commandes: Record<string, number>;
  livraisons: LigneJours[];
  consoParArticle: Map<string, (string | null)[]>;
  /** Jours de consommation approximative par article du catalogue (voir `consoApproximativeParArticleCatalogue`). */
  consoApproxParArticle?: Map<string, (string | null)[]>;
  /** Sans filtre de domaine : les articles livrés hors de la liste (autre domaine, inactifs) sont ajoutés. */
  inclureHorsCatalogue: boolean;
  legumes?: { nom: string; unite?: string | null; cmd: number[]; liv: number[]; /** Identifiant de la ligne (nom + unité quand un achat est dans une autre unité). */ id?: string }[];
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
      id: a.id, designation: a.designation, categorie: a.categorie, lien: true, ...(a.unite !== undefined ? { unite: a.unite } : {}),
      cmd: p.jours.map((j) => p.commandes[`${a.id}_${j}`] ?? 0),
      liv: livParId.get(a.id)?.jours ?? vide,
      conso: p.consoParArticle.get(a.id) ?? inconnu,
      ...(p.consoApproxParArticle?.has(a.id) ? { consoApprox: p.consoApproxParArticle.get(a.id)! } : {}),
    });
  }
  if (p.inclureHorsCatalogue) {
    for (const l of p.livraisons) {
      if (vus.has(l.id)) continue;
      pousser({ id: l.id, designation: l.designation, categorie: "À classer", lien: true, ...(l.unite !== undefined ? { unite: l.unite } : {}), cmd: vide, liv: l.jours, conso: p.consoParArticle.get(l.id) ?? inconnu, ...(p.consoApproxParArticle?.has(l.id) ? { consoApprox: p.consoApproxParArticle.get(l.id)! } : {}) });
    }
  }
  for (const g of p.legumes ?? []) pousser({ id: g.id ?? `legume:${g.nom}`, designation: g.nom, categorie: "Légumes frais", lien: false, ...(g.unite !== undefined ? { unite: g.unite } : {}), cmd: g.cmd, liv: g.liv, conso: inconnu });
  return lignes.sort((a, b) => a.categorie.localeCompare(b.categorie, "fr") || a.designation.localeCompare(b.designation, "fr"));
}

const texteQte = (v: string | null) => (v === null ? "—" : formaterNombre(Number(v), { maximumFractionDigits: 3 }));

/** Un écart signé d'une cellule d'export : le texte (« +2 », « -1,5 ») et, pour le consommé, sa nature. */
export type EcartExport = { signe: string; nature: "LIVRE_DIFFERE" | EcartJour };

/** Colonnes d'un jour dans l'export : commandé, livré, consommé (les valeurs ne changent pas, seul l'en-tête est court). */
export const ENTETES_JOUR = ["Cmd", "Livré", "Conso"] as const;

/**
 * Export (PDF / Excel) de la comparaison : par jour, commandé / livré / consommé ; puis les totaux.
 * Le total consommé n'existe que si chaque jour est connu. `ecarts` : cellules « r:c » du consommé
 * en écart avec le livré (à colorer). `ecartsCL` : cellules commandé et livré d'un jour où le livré
 * diffère du commandé. `signes` : l'écart signé de ces cellules (« +2 », « -1 »), à écrire à côté de
 * la valeur pour ne pas dépendre de la seule couleur. `lignes` ne porte que les valeurs, sans signe.
 */
export function lignesExportComparaison(lignesComp: LigneComparaison[], labels: string[]): {
  lignes: string[][]; sectionRows: number[]; entete: string[]; colRole: RoleCol[]; ecarts: Set<string>; colonnes: Colonne[];
  ecartsCL: Set<string>; signes: Map<string, EcartExport>;
  /** En-têtes courts (« Cmd / Livré / Conso »), à lire sous les groupes (un par jour + « Total »). */
  enteteCourt: string[]; groupes: { libelle: string; debut: number; nb: number }[];
} {
  const lignes: string[][] = [];
  const sectionRows: number[] = [];
  const ecarts = new Set<string>();
  const ecartsCL = new Set<string>();
  const signes = new Map<string, EcartExport>();
  let categorie: string | null = null;
  for (const l of lignesComp) {
    if (l.categorie !== categorie) { sectionRows.push(lignes.length); lignes.push([l.categorie]); categorie = l.categorie; }
    const cells = [libelleAvecUnite(l.designation, l.unite)];
    labels.forEach((_, i) => {
      const r = lignes.length, c = cells.length;
      const ecartL = ecartLivreCommande(l.cmd[i]!, l.liv[i]!);
      if (livreDiffereDuCommande(l.cmd[i]!, l.liv[i]!)) {
        ecartsCL.add(`${r}:${c}`); ecartsCL.add(`${r}:${c + 1}`);
        if (ecartL) signes.set(`${r}:${c + 1}`, { signe: ecartL, nature: "LIVRE_DIFFERE" });
      }
      const ecart = l.ecarts[i] ?? null;
      if (ecart) {
        ecarts.add(`${r}:${c + 2}`);
        const signe = ecartConsoLivre(l.liv[i]!, l.conso[i] ?? null);
        if (signe) signes.set(`${r}:${c + 2}`, { signe, nature: ecart });
      }
      const approx = l.consoApprox?.[i] ?? null;
      cells.push(nbExport(l.cmd[i]!), nbExport(l.liv[i]!), `${approx !== null && l.conso[i] != null ? "≈ " : ""}${texteQte(l.conso[i] ?? null)}`);
    });
    const totalConsomme = l.conso.every((v) => v !== null) ? l.conso.reduce((t, v) => t.plus(v!), new D(0)).toString() : null;
    const totalApprox = totalConsomme !== null && (l.consoApprox ?? []).some((v) => v !== null);
    cells.push(nbExport(sommeExacte(l.cmd)), nbExport(sommeExacte(l.liv)), `${totalApprox ? "≈ " : ""}${texteQte(totalConsomme)}`);
    lignes.push(cells);
  }
  const entete = ["Article", ...labels.flatMap((l) => [`${l} Cmd`, `${l} Liv`, `${l} Conso`]), "Total Cmd", "Total Liv", "Total Conso"];
  const colRole: RoleCol[] = [null, ...[...labels, "total"].flatMap(() => ["cmd", "liv", "conso"] as RoleCol[])];
  const colW = `${83 / ((labels.length + 1) * 3)}%`;
  const colonnes: Colonne[] = [
    { header: "Article", width: "17%" },
    ...[...labels, "Total"].flatMap(() => ENTETES_JOUR.map((h) => ({ header: h, width: colW, align: "right" as const }))),
  ];
  const enteteCourt = ["Article", ...[...labels, "Total"].flatMap(() => [...ENTETES_JOUR])];
  const groupes = [...labels, "Total"].map((libelle, i) => ({ libelle, debut: 1 + i * 3, nb: 3 }));
  return { lignes, sectionRows, entete, colRole, ecarts, colonnes, ecartsCL, signes, enteteCourt, groupes };
}

/**
 * PDF de la comparaison : 25 colonnes ne tiennent pas lisiblement sur une page (constaté au rendu :
 * « 1 180,125 » se coupait sur deux lignes). Deux parties, chacune sur sa page paysage : lundi à jeudi,
 * puis vendredi à dimanche et les totaux. `indices` : colonnes de l'export reprises dans la partie ;
 * `groupes` : les jours (et « Total ») qui coiffent chacun leurs trois colonnes.
 */
export function partiesPdfComparaison(labels: string[]): { titre: string; indices: number[]; colonnes: Colonne[]; groupes: { libelle: string; nb: number }[] }[] {
  const coupe = Math.ceil(labels.length / 2 + 0.5); // 7 jours : 4 + 3 (+ totaux)
  const groupes = [
    // « à » et non « → » : la flèche n'existe pas dans Optima, la police des PDF (elle sortait en « ’ »).
    { titre: `${labels[0]} à ${labels[coupe - 1]}`, jours: labels.slice(0, coupe).map((l, i) => ({ l, i })) },
    { titre: `${labels[coupe]} à ${labels[labels.length - 1]}, et totaux de la semaine`, jours: [...labels.slice(coupe).map((l, i) => ({ l, i: coupe + i })), { l: "Total", i: labels.length }] },
  ];
  return groupes.map((g) => {
    // Le consommé porte l'écart signé sous sa valeur : une colonne une fois et demie plus large.
    const unite = 83 / (g.jours.length * 3.5);
    const largeurs = [`${unite}%`, `${unite}%`, `${unite * 1.5}%`];
    return {
      titre: g.titre,
      indices: [0, ...g.jours.flatMap(({ i }) => [1 + i * 3, 2 + i * 3, 3 + i * 3])],
      groupes: g.jours.map(({ l }) => ({ libelle: l, nb: 3 })),
      colonnes: [
        { header: "Article", width: "17%" },
        ...g.jours.flatMap(() => ENTETES_JOUR.map((h, k) => ({ header: h, width: largeurs[k]!, align: "right" as const }))),
      ],
    };
  });
}
