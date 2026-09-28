import Decimal from "decimal.js";
import { convertirDepuisUniteArticle, convertirVersUniteArticle, type StockRestaurant } from "@/lib/fiches/disponibilite";

// Stock et consommation du RESTAURANT, dérivés à l'affichage (spec 2026-09-28, « Livraisons du dépôt
// au restaurant »). Fonctions PURES : ni Prisma, ni React, aucune exception.
//
// Doctrine :
//   1. Le comptage reste la vérité du terrain : on n'écrit JAMAIS de comptage à partir d'une sortie.
//      stock théorique (R, J) = dernier comptage de R à une date C ≤ J
//                             + Σ des livraisons du dépôt vers R datées de (C, J], dans l'unité de R.
//   2. Le jour du comptage, le comptage fait foi : on suppose qu'il est fait APRÈS les livraisons du
//      jour, donc une livraison datée du jour C est déjà dans le chiffre compté (borne ouverte en C).
//   3. Seules les sorties au motif « Livraison restaurant » alimentent le restaurant (décision de la
//      Direction du 2026-09-28) ; une perte reste au dépôt.
//   4. Rien n'est deviné : un article du catalogue non rattaché, rattaché à PLUSIEURS articles du
//      restaurant (tous espaces confondus) ou d'unité impossible à convertir n'est pas additionné ;
//      la livraison est signalée.

const D = Decimal.clone({ precision: 60 });

export const MOTIF_LIVRAISON_RESTAURANT = "LIVRAISON_RESTAURANT";

// ─── Entrées (dénormalisées par le chargeur) ─────────────────────────────────

/**
 * Article du restaurant ACTIF. `unite` : unité de comptage ; `articleStockId` : rattachement ;
 * `uniteCatalogue` : unité de l'article rattaché (disponibilité des plats).
 */
export type ArticleRestoSR = {
  id: string; designation: string; espace: "CUISINE" | "BAR"; unite: string | null; articleStockId: string | null;
  uniteCatalogue?: string | null;
};
/** Comptage saisi au restaurant (dates PURES AAAA-MM-JJ, quantités en texte pleine précision). */
export type ComptageSR = { articleRestoId: string; date: string; quantite: string };
/** Sortie du dépôt, dans l'unité de l'article du catalogue. */
export type LivraisonSR = {
  id: string; articleStockId: string; designation: string; uniteCatalogue: string | null;
  date: string; quantite: string; categorieSortie: string | null;
};
export type EntreesStockResto = { articles: ArticleRestoSR[]; comptages: ComptageSR[]; livraisons: LivraisonSR[] };

// ─── Sorties ─────────────────────────────────────────────────────────────────

export type EtatRattachement =
  | { etat: "OK"; articleRestoId: string }
  | { etat: "NON_RATTACHE" }
  | { etat: "A_REPARTIR"; articleRestoIds: string[] }
  | { etat: "UNITE_INCOMPATIBLE"; articleRestoId: string };

/** Livraison du dépôt qui N'EST PAS additionnée au stock d'un article du restaurant, et pourquoi. */
export type SignalementLivraison = {
  motif: "UNITE_INCOMPATIBLE" | "A_REPARTIR";
  livraisonId: string;
  date: string;
  /** Désignation de l'article du catalogue livré. */
  designation: string;
  /** Quantité sortie du dépôt, dans l'unité du catalogue. */
  quantite: string;
  uniteCatalogue: string | null;
  /** « À répartir » : désignations des articles du restaurant rattachés au même article du catalogue. */
  candidats?: string[];
};

export type LivraisonRecue = { livraisonId: string; date: string; quantiteCatalogue: string; quantiteResto: string };

export type StockTheorique = {
  articleRestoId: string;
  /** Unité du restaurant ; null = inconnu (ni comptage ni livraison additionnable) — affiché « — ». */
  stock: string | null;
  dernierComptage: { date: string; quantite: string } | null;
  /** Livraisons additionnées depuis le dernier comptage (toutes, faute de comptage). */
  livraisonsDepuis: LivraisonRecue[];
  /** Plus récent du dernier comptage et de la dernière livraison additionnée (règle des 7 jours). */
  derniereDate: string | null;
  aucunComptage: boolean;
  /** Livraisons de la même fenêtre NON additionnées (unité incompatible, à répartir). */
  signalements: SignalementLivraison[];
};

export type ResultatStockResto = { parArticle: Map<string, StockTheorique>; nonRattachees: LivraisonSR[] };

export const MENTION_AUCUN_COMPTAGE = "aucun comptage : stock estimé à partir des seules livraisons";
export const LIBELLE_SIGNALEMENT: Record<SignalementLivraison["motif"] | "NON_RATTACHE", string> = {
  UNITE_INCOMPATIBLE: "unité incompatible",
  A_REPARTIR: "à répartir",
  NON_RATTACHE: "non rattaché : n'alimente pas le restaurant",
};

// ─── Rattachement d'une livraison ────────────────────────────────────────────

/**
 * Article du restaurant qui reçoit les livraisons d'un article du catalogue : UN SEUL rattachement
 * actif, d'unité convertible. Sinon, la raison (jamais un choix au hasard).
 */
export function etatRattachementLivraison(articleStockId: string, uniteCatalogue: string | null, articles: ArticleRestoSR[]): EtatRattachement {
  const candidats = articles.filter((a) => a.articleStockId === articleStockId);
  if (candidats.length === 0) return { etat: "NON_RATTACHE" };
  if (candidats.length > 1) return { etat: "A_REPARTIR", articleRestoIds: candidats.map((c) => c.id) };
  const r = candidats[0]!;
  if (convertirDepuisUniteArticle(1, uniteCatalogue ?? "", r.unite ?? "") === null) return { etat: "UNITE_INCOMPATIBLE", articleRestoId: r.id };
  return { etat: "OK", articleRestoId: r.id };
}

// ─── Index (construit une fois par jeu d'entrées) ────────────────────────────

type Index = {
  comptages: Map<string, ComptageSR[]>; // par article du restaurant, date croissante
  recues: Map<string, LivraisonRecue[]>; // idem
  signalees: Map<string, SignalementLivraison[]>; // idem
  nonRattachees: LivraisonSR[];
};

const INDEX = new WeakMap<EntreesStockResto, Index>();
const parDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const pousser = <T>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };

function indexer(e: EntreesStockResto): Index {
  const deja = INDEX.get(e);
  if (deja) return deja;
  const idx: Index = { comptages: new Map(), recues: new Map(), signalees: new Map(), nonRattachees: [] };
  const noms = new Map(e.articles.map((a) => [a.id, a.designation]));
  const unites = new Map(e.articles.map((a) => [a.id, a.unite]));
  for (const c of e.comptages) if (noms.has(c.articleRestoId)) pousser(idx.comptages, c.articleRestoId, c);

  for (const l of e.livraisons) {
    if (l.categorieSortie !== MOTIF_LIVRAISON_RESTAURANT) continue;
    const r = etatRattachementLivraison(l.articleStockId, l.uniteCatalogue, e.articles);
    const signal = (motif: SignalementLivraison["motif"], candidats?: string[]): SignalementLivraison => ({
      motif, livraisonId: l.id, date: l.date, designation: l.designation, quantite: l.quantite, uniteCatalogue: l.uniteCatalogue,
      ...(candidats ? { candidats } : {}),
    });
    if (r.etat === "NON_RATTACHE") idx.nonRattachees.push(l);
    else if (r.etat === "UNITE_INCOMPATIBLE") pousser(idx.signalees, r.articleRestoId, signal("UNITE_INCOMPATIBLE"));
    else if (r.etat === "A_REPARTIR") {
      const candidats = r.articleRestoIds.map((id) => noms.get(id)!);
      for (const id of r.articleRestoIds) pousser(idx.signalees, id, signal("A_REPARTIR", candidats));
    } else {
      const quantiteResto = convertirDepuisUniteArticle(l.quantite, l.uniteCatalogue ?? "", unites.get(r.articleRestoId) ?? "")!;
      pousser(idx.recues, r.articleRestoId, { livraisonId: l.id, date: l.date, quantiteCatalogue: l.quantite, quantiteResto });
    }
  }
  for (const m of [idx.comptages, idx.recues, idx.signalees] as Map<string, { date: string }[]>[]) for (const l of m.values()) l.sort(parDate);
  idx.nonRattachees.sort(parDate);
  INDEX.set(e, idx);
  return idx;
}

// ─── API ─────────────────────────────────────────────────────────────────────

function stockDe(idx: Index, articleRestoId: string, jour: string): StockTheorique {
  const comptes = (idx.comptages.get(articleRestoId) ?? []).filter((c) => c.date <= jour);
  const dernier = comptes.at(-1) ?? null;
  // Fenêtre (C, J] : une livraison du jour du comptage est déjà dans le chiffre compté.
  const dansFenetre = (d: string) => d <= jour && (dernier === null || d > dernier.date);
  const livraisonsDepuis = (idx.recues.get(articleRestoId) ?? []).filter((l) => dansFenetre(l.date));
  const signalements = (idx.signalees.get(articleRestoId) ?? []).filter((s) => dansFenetre(s.date));

  let stock: string | null = null;
  if (dernier !== null || livraisonsDepuis.length > 0) {
    stock = livraisonsDepuis.reduce((t, l) => t.plus(l.quantiteResto), new D(dernier?.quantite ?? 0)).toString();
  }
  const derniereLivraison = livraisonsDepuis.at(-1)?.date ?? null;
  const derniereDate = [dernier?.date ?? null, derniereLivraison].filter((d): d is string => d !== null).sort().at(-1) ?? null;
  return {
    articleRestoId,
    stock,
    dernierComptage: dernier ? { date: dernier.date, quantite: dernier.quantite } : null,
    livraisonsDepuis,
    derniereDate,
    aucunComptage: dernier === null,
    signalements,
  };
}

/** Stock théorique de chaque article du restaurant au jour `jour` (AAAA-MM-JJ, inclus). */
export function stockRestaurantTheorique(e: EntreesStockResto, jour: string): ResultatStockResto {
  const idx = indexer(e);
  return {
    parArticle: new Map(e.articles.map((a) => [a.id, stockDe(idx, a.id, jour)])),
    nonRattachees: idx.nonRattachees.filter((l) => l.date <= jour),
  };
}

/** Reçu du dépôt par un article du restaurant le jour `jour` : null (« — ») quand rien n'est additionné. */
export function recuDuDepot(e: EntreesStockResto, articleRestoId: string, jour: string): { quantite: string | null; signalements: SignalementLivraison[] } {
  const idx = indexer(e);
  const recues = (idx.recues.get(articleRestoId) ?? []).filter((l) => l.date === jour);
  return {
    quantite: recues.length === 0 ? null : recues.reduce((t, l) => t.plus(l.quantiteResto), new D(0)).toString(),
    signalements: (idx.signalees.get(articleRestoId) ?? []).filter((s) => s.date === jour),
  };
}

// ─── Consommation réelle ─────────────────────────────────────────────────────

export type ConsommationReelle =
  | {
      etat: "CONNUE";
      /** Unité du restaurant ; négative = plus compté que reçu, signalée, jamais masquée. */
      quantite: string;
      negative: boolean;
      stockVeille: string;
      recu: string;
      compte: string;
      /** La veille n'a aucun comptage derrière elle : stock estimé à partir des seules livraisons. */
      veilleEstimee: boolean;
    }
  | { etat: "INCONNUE"; raison: "PAS_DE_COMPTAGE" | "STOCK_VEILLE_INCONNU" | "LIVRAISON_NON_COMPTEE" };

export const ECART_NEGATIF = "écart : plus compté que reçu";
export const LIBELLE_CONSO_INCONNUE: Record<Extract<ConsommationReelle, { etat: "INCONNUE" }>["raison"], string> = {
  PAS_DE_COMPTAGE: "pas de comptage ce jour",
  STOCK_VEILLE_INCONNU: "stock de la veille inconnu",
  LIVRAISON_NON_COMPTEE: "livraison non additionnée (à répartir ou unité incompatible)",
};

/** Veille d'une date PURE AAAA-MM-JJ (calcul en UTC, aucun fuseau). */
export function veilleDe(jour: string): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consommation réelle d'un article du restaurant le jour J = stock de la veille (compté, sinon
 * théorique) + livré le jour J − stock compté le jour J. N'existe que si un comptage existe le
 * jour J ; sinon « — » (INCONNUE), jamais 0.
 */
export function consommationReelle(e: EntreesStockResto, articleRestoId: string, jour: string): ConsommationReelle {
  const idx = indexer(e);
  const compte = (idx.comptages.get(articleRestoId) ?? []).find((c) => c.date === jour);
  if (!compte) return { etat: "INCONNUE", raison: "PAS_DE_COMPTAGE" };
  const veille = stockDe(idx, articleRestoId, veilleDe(jour));
  if (veille.stock === null) return { etat: "INCONNUE", raison: "STOCK_VEILLE_INCONNU" };
  const recu = recuDuDepot(e, articleRestoId, jour);
  if (veille.signalements.length > 0 || recu.signalements.length > 0) return { etat: "INCONNUE", raison: "LIVRAISON_NON_COMPTEE" };
  const quantite = new D(veille.stock).plus(recu.quantite ?? 0).minus(compte.quantite);
  return {
    etat: "CONNUE",
    quantite: quantite.toString(),
    negative: quantite.isNegative() && !quantite.isZero(),
    stockVeille: veille.stock,
    recu: recu.quantite ?? "0",
    compte: compte.quantite,
    veilleEstimee: veille.aucunComptage,
  };
}

// ─── Part du restaurant dans la disponibilité des plats ──────────────────────

/**
 * Stock théorique du restaurant par article du CATALOGUE, dans l'unité de l'article (décision du
 * 2026-09-24 : le stock qui fait foi est dépôt + restaurant). Pour chaque article du restaurant
 * rattaché : dernier comptage converti + livraisons reçues depuis, prises TELLES QU'ELLES SONT SORTIES
 * du dépôt (déjà dans l'unité de l'article) — une livraison retire du dépôt exactement ce qu'elle
 * ajoute ici : le total ne bouge pas, sans double compte.
 * Plusieurs articles du restaurant rattachés : les parts s'additionnent ; `dateComptage` et `dateMaj`
 * retiennent la plus ANCIENNE (c'est elle qui dit à quel point le chiffre peut être périmé).
 * Une livraison à répartir ou une unité non convertible rend l'article inexploitable (annoncé).
 */
export function stockRestaurantPourDisponibilite(e: EntreesStockResto, jour: string): Map<string, StockRestaurant> {
  const { parArticle } = stockRestaurantTheorique(e, jour);
  const res = new Map<string, StockRestaurant>();
  const plusAncienne = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);
  for (const a of e.articles) {
    const cat = a.articleStockId;
    if (!cat) continue;
    const s = parArticle.get(a.id)!;
    if (s.stock === null && s.signalements.length === 0) continue; // ni comptage ni livraison : n'apporte rien
    const deja = res.get(cat);
    if (deja !== undefined && deja.etat !== "OK") continue;
    if (s.signalements.some((x) => x.motif === "A_REPARTIR")) { res.set(cat, { etat: "A_REPARTIR", articleResto: a.designation }); continue; }
    const compte = s.dernierComptage === null ? "0" : convertirVersUniteArticle(s.dernierComptage.quantite, a.unite ?? "", a.uniteCatalogue ?? "");
    if (compte === null || s.signalements.some((x) => x.motif === "UNITE_INCOMPATIBLE")) {
      res.set(cat, { etat: "UNITE_NON_CONVERTIBLE", articleResto: a.designation });
      continue;
    }
    const recu = s.livraisonsDepuis.length === 0 ? null : s.livraisonsDepuis.reduce((t, l) => t.plus(l.quantiteCatalogue), new D(0));
    const quantite = new D(compte).plus(recu ?? 0);
    const part = { dateComptage: s.dernierComptage?.date ?? null, dateMaj: s.derniereDate! };
    if (deja === undefined) {
      res.set(cat, { etat: "OK", quantite: quantite.toString(), ...part, recu: recu === null ? null : recu.toString() });
    } else {
      const cumulRecu = deja.recu == null && recu === null ? null : new D(deja.recu ?? 0).plus(recu ?? 0).toString();
      res.set(cat, {
        etat: "OK",
        quantite: new D(deja.quantite).plus(quantite).toString(),
        dateComptage: plusAncienne(deja.dateComptage, part.dateComptage),
        dateMaj: plusAncienne(deja.dateMaj ?? null, part.dateMaj)!,
        recu: cumulRecu,
      });
    }
  }
  return res;
}
