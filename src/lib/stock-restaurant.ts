import Decimal from "decimal.js";
import { convertirDepuisUniteArticle, convertirVersUniteArticle, type StockRestaurant } from "@/lib/fiches/disponibilite";
import { uniteManquante } from "@/lib/fiches/conversion";

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
  /** Domaine de l'article du catalogue : dit l'espace (Cuisine / Bar) quand il est rattaché aux deux. */
  domaine?: string | null;
};

/**
 * Espace du restaurant d'un domaine du catalogue (« Cuisine (nourriture) », « Bar (boissons) »).
 * Tout autre domaine (AUTRE…) ne désigne aucun espace.
 */
export function espaceDuDomaine(domaine: string | null | undefined): "CUISINE" | "BAR" | null {
  return domaine === "NOURRITURE" ? "CUISINE" : domaine === "BOISSON" ? "BAR" : null;
}
/**
 * `debutLivraisons` (AAAA-MM-JJ) : les livraisons ne sont chargées qu'à partir de cette date (plus
 * celles d'après le dernier comptage de chaque article compté). Un article SANS comptage n'estime
 * donc son stock qu'à partir d'elle — jamais sur un historique chargé à moitié.
 */
export type EntreesStockResto = { articles: ArticleRestoSR[]; comptages: ComptageSR[]; livraisons: LivraisonSR[]; debutLivraisons?: string };

// ─── Sorties ─────────────────────────────────────────────────────────────────

export type EtatRattachement =
  | { etat: "OK"; articleRestoId: string }
  | { etat: "NON_RATTACHE" }
  | { etat: "A_REPARTIR"; articleRestoIds: string[] }
  | { etat: "UNITE_RESTO_MANQUANTE"; articleRestoId: string }
  | { etat: "UNITE_CATALOGUE_MANQUANTE"; articleRestoId: string }
  | { etat: "UNITE_INCOMPATIBLE"; articleRestoId: string };

type MotifUnite = "UNITE_INCOMPATIBLE" | "UNITE_RESTO_MANQUANTE" | "UNITE_CATALOGUE_MANQUANTE";

/** Livraison du dépôt qui N'EST PAS additionnée au stock d'un article du restaurant, et pourquoi. */
export type SignalementLivraison = {
  motif: MotifUnite | "A_REPARTIR";
  livraisonId: string;
  date: string;
  /** Désignation de l'article du catalogue livré. */
  designation: string;
  /** Quantité sortie du dépôt, dans l'unité du catalogue. */
  quantite: string;
  uniteCatalogue: string | null;
  /** « À répartir » : désignations des articles du restaurant rattachés au même article du catalogue. */
  candidats?: string[];
  /** Article du catalogue livré, et article du restaurant concerné par ce signalement. */
  articleStockId: string;
  articleRestoId: string;
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
  UNITE_INCOMPATIBLE: "unités incompatibles",
  UNITE_RESTO_MANQUANTE: "unité du restaurant non renseignée",
  UNITE_CATALOGUE_MANQUANTE: "unité du catalogue non renseignée",
  A_REPARTIR: "à répartir",
  NON_RATTACHE: "non rattaché : n'alimente pas le restaurant",
};

// ─── Rattachement d'une livraison ────────────────────────────────────────────

/** Avertissement NON BLOQUANT à la saisie d'une sortie « Livraison restaurant » (Stock → Mouvements). */
export const AVERTISSEMENT_LIVRAISON = "cette livraison n'alimentera pas le stock du restaurant";
export type EtatLivraison = EtatRattachement["etat"];

/**
 * Article du restaurant qui reçoit les livraisons d'un article du catalogue : UN SEUL rattachement
 * actif PAR ESPACE (spec). Rattaché en Cuisine ET au Bar : l'espace est celui du domaine de l'article
 * (nourriture → Cuisine, boissons → Bar) ; domaine inconnu, ou deux articles dans le même espace :
 * « à répartir ». Puis les unités : absente au restaurant, absente au catalogue, ou incompatibles.
 * Jamais un choix au hasard.
 */
export function etatRattachementLivraison(
  articleStockId: string, uniteCatalogue: string | null, articles: ArticleRestoSR[], domaine?: string | null,
): EtatRattachement {
  const candidats = articles.filter((a) => a.articleStockId === articleStockId);
  if (candidats.length === 0) return { etat: "NON_RATTACHE" };
  let r = candidats[0]!;
  if (candidats.length > 1) {
    const espace = espaceDuDomaine(domaine);
    const dansEspace = espace ? candidats.filter((c) => c.espace === espace) : [];
    if (dansEspace.length !== 1) return { etat: "A_REPARTIR", articleRestoIds: (dansEspace.length > 1 ? dansEspace : candidats).map((c) => c.id) };
    r = dansEspace[0]!;
  }
  if (uniteManquante(r.unite)) return { etat: "UNITE_RESTO_MANQUANTE", articleRestoId: r.id };
  if (uniteManquante(uniteCatalogue)) return { etat: "UNITE_CATALOGUE_MANQUANTE", articleRestoId: r.id };
  if (convertirDepuisUniteArticle(1, uniteCatalogue ?? "", r.unite ?? "") === null) return { etat: "UNITE_INCOMPATIBLE", articleRestoId: r.id };
  return { etat: "OK", articleRestoId: r.id };
}

/**
 * Ce qu'il faut faire pour qu'une livraison alimente le restaurant, et OÙ le faire. null : rien à
 * faire (rattachement unique, unités convertibles).
 */
export function conseilLivraison(etat: EtatRattachement, articleStockId: string, articles: ArticleRestoSR[]): { texte: string; href: string } | null {
  const espaceDe = (id: string) => articles.find((a) => a.id === id)?.espace ?? "CUISINE";
  switch (etat.etat) {
    case "OK": return null;
    case "NON_RATTACHE": return { texte: "non rattaché : rattachez l'article", href: "/stock/restaurant" };
    case "UNITE_RESTO_MANQUANTE": return { texte: "unité du restaurant non renseignée : renseignez-la dans Stock restaurant", href: `/stock/restaurant?espace=${espaceDe(etat.articleRestoId)}` };
    case "UNITE_CATALOGUE_MANQUANTE": return { texte: "unité du catalogue non renseignée : renseignez-la sur la fiche de l'article", href: `/stock/catalogue/${articleStockId}` };
    case "UNITE_INCOMPATIBLE": return { texte: "unités incompatibles : corrigez l'unité du restaurant ou le rattachement", href: `/stock/restaurant?espace=${espaceDe(etat.articleRestoId)}` };
    case "A_REPARTIR": return { texte: "à répartir : plusieurs articles du restaurant rattachés", href: `/stock/restaurant?espace=${espaceDe(etat.articleRestoIds[0]!)}` };
  }
}

/** Conseil (texte + lien) d'une livraison signalée dans la grille du restaurant. */
export function conseilSignalement(s: SignalementLivraison, articles: ArticleRestoSR[]): { texte: string; href: string } {
  const etat: EtatRattachement = s.motif === "A_REPARTIR" ? { etat: "A_REPARTIR", articleRestoIds: [s.articleRestoId] } : { etat: s.motif, articleRestoId: s.articleRestoId };
  return conseilLivraison(etat, s.articleStockId, articles)!;
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
    const r = etatRattachementLivraison(l.articleStockId, l.uniteCatalogue, e.articles, l.domaine);
    const signal = (motif: SignalementLivraison["motif"], articleRestoId: string, candidats?: string[]): SignalementLivraison => ({
      motif, livraisonId: l.id, date: l.date, designation: l.designation, quantite: l.quantite, uniteCatalogue: l.uniteCatalogue,
      articleStockId: l.articleStockId, articleRestoId, ...(candidats ? { candidats } : {}),
    });
    if (r.etat === "NON_RATTACHE") idx.nonRattachees.push(l);
    else if (r.etat === "UNITE_INCOMPATIBLE" || r.etat === "UNITE_RESTO_MANQUANTE" || r.etat === "UNITE_CATALOGUE_MANQUANTE") pousser(idx.signalees, r.articleRestoId, signal(r.etat, r.articleRestoId));
    else if (r.etat === "A_REPARTIR") {
      const candidats = r.articleRestoIds.map((id) => noms.get(id)!);
      for (const id of r.articleRestoIds) pousser(idx.signalees, id, signal("A_REPARTIR", id, candidats));
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

function stockDe(idx: Index, articleRestoId: string, jour: string, debutLivraisons?: string): StockTheorique {
  const comptes = (idx.comptages.get(articleRestoId) ?? []).filter((c) => c.date <= jour);
  const dernier = comptes.at(-1) ?? null;
  // Fenêtre (C, J] : une livraison du jour du comptage est déjà dans le chiffre compté.
  // Sans comptage : seulement les livraisons de la période chargée (`debutLivraisons`).
  const dansFenetre = (d: string) => d <= jour && (dernier === null ? !debutLivraisons || d >= debutLivraisons : d > dernier.date);
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
    parArticle: new Map(e.articles.map((a) => [a.id, stockDe(idx, a.id, jour, e.debutLivraisons)])),
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
  const veille = stockDe(idx, articleRestoId, veilleDe(jour), e.debutLivraisons);
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
 * Plusieurs articles du restaurant rattachés : les parts s'additionnent ; `dateComptage` retient le
 * plus ANCIEN des derniers comptages (c'est lui qui dit à quel point le chiffre peut être périmé).
 * Un article rattaché sans AUCUN comptage mais avec des livraisons rend la part ESTIMÉE : les seules
 * livraisons ne disent rien de ce qui a été consommé (décision du contrôleur, 2026-09-28).
 * Une livraison à répartir ou une unité non convertible rend l'article inexploitable (annoncé).
 */
export function stockRestaurantPourDisponibilite(e: EntreesStockResto, jour: string): Map<string, StockRestaurant> {
  const { parArticle } = stockRestaurantTheorique(e, jour);
  const res = new Map<string, StockRestaurant>();
  // Ordre de gravité : une part inexploitable l'emporte sur une part estimée, qui l'emporte sur OK.
  const gravite = (x: StockRestaurant | undefined) => (x === undefined ? -1 : x.etat === "OK" ? 0 : x.etat === "ESTIME" ? 1 : 2);
  for (const a of e.articles) {
    const cat = a.articleStockId;
    if (!cat) continue;
    const s = parArticle.get(a.id)!;
    if (s.stock === null && s.signalements.length === 0) continue; // ni comptage ni livraison : n'apporte rien
    const deja = res.get(cat);
    if (gravite(deja) === 2) continue;
    if (s.signalements.some((x) => x.motif === "A_REPARTIR")) { res.set(cat, { etat: "A_REPARTIR", articleResto: a.designation }); continue; }
    const compte = s.dernierComptage === null ? "0" : convertirVersUniteArticle(s.dernierComptage.quantite, a.unite ?? "", a.uniteCatalogue ?? "");
    if (compte === null || s.signalements.some((x) => x.motif !== "A_REPARTIR")) {
      res.set(cat, { etat: "UNITE_NON_CONVERTIBLE", articleResto: a.designation });
      continue;
    }
    const recu = s.livraisonsDepuis.length === 0 ? null : s.livraisonsDepuis.reduce((t, l) => t.plus(l.quantiteCatalogue), new D(0));
    const quantite = new D(compte).plus(recu ?? 0);
    const cumul = (x: string | null | undefined, y: InstanceType<typeof D> | null) => (x == null && y === null ? null : new D(x ?? 0).plus(y ?? 0).toString());
    if (deja === undefined) {
      res.set(cat, s.dernierComptage === null
        ? { etat: "ESTIME", quantite: quantite.toString(), recu: recu === null ? null : recu.toString() }
        : { etat: "OK", quantite: quantite.toString(), dateComptage: s.dernierComptage.date, recu: recu === null ? null : recu.toString() });
      continue;
    }
    if (deja.etat !== "OK" && deja.etat !== "ESTIME") continue;
    const somme = new D(deja.quantite).plus(quantite).toString();
    if (deja.etat === "ESTIME" || s.dernierComptage === null) {
      res.set(cat, { etat: "ESTIME", quantite: somme, recu: cumul(deja.recu, recu) });
    } else {
      const date = deja.dateComptage < s.dernierComptage.date ? deja.dateComptage : s.dernierComptage.date;
      res.set(cat, { etat: "OK", quantite: somme, dateComptage: date, recu: cumul(deja.recu, recu) });
    }
  }
  return res;
}
