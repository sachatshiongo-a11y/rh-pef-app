import Decimal from "decimal.js";
import { convertirDepuisUniteArticle, convertirVersUniteArticle, type StockRestaurant } from "@/lib/fiches/disponibilite";
import { uniteManquante, type UniteArticle } from "@/lib/fiches/conversion";
import type { ConsoVenteSR, VenteAVerifierSR } from "@/lib/ventes-consommation";

// Stock et consommation du RESTAURANT, dérivés à l'affichage (spec 2026-09-28, « Livraisons du dépôt
// au restaurant »). Fonctions PURES : ni Prisma, ni React, aucune exception.
//
// Doctrine :
//   1. Le comptage reste la vérité du terrain : on n'écrit JAMAIS de comptage à partir d'une sortie.
//      stock théorique (R, J) = dernier comptage de R à une date C ≤ J
//                             + Σ des livraisons du dépôt vers R datées de (C, J], dans l'unité de R.
//   2. Le jour du comptage, le comptage fait foi : on suppose qu'il est fait APRÈS les livraisons du
//      jour, donc une livraison datée du jour C est déjà dans le chiffre compté (borne ouverte en C).
//      VENTES (décision Direction du 2026-10-12) : depuis le dernier comptage, le stock théorique RETIRE aussi
//      la consommation des ventes saisies × fiches techniques (`ventes-consommation.ts`) :
//      stock théorique (R, J) = comptage (C) + livraisons (C, J] − ventes (C, J], unité de R.
//      Le comptage du restaurant est celui de FIN DE JOURNÉE (la consommation réelle du jour J est
//      « stock de la veille + reçu du jour − compté le jour J ») : les ventes du jour C sont déjà dans le
//      chiffre compté, comme ses livraisons — borne ouverte en C pour les ventes aussi, jamais comptées
//      deux fois. Une vente qu'on ne sait pas déduire (fiche incomplète, unité inconvertible, vente à
//      répartir) rend le théorique « À vérifier » : jamais un faux chiffre, jamais 0. Sans comptage, le
//      stock n'est qu'une estimation de livraisons : aucune vente n'en est retirée.
//   3. Seules les sorties au motif « Livraison restaurant » alimentent le restaurant (décision de la
//      Direction du 2026-09-28) ; une perte reste au dépôt.
//   4. Rien n'est deviné : un article du catalogue non rattaché, rattaché à PLUSIEURS articles du
//      restaurant (tous espaces confondus) ou d'unité impossible à convertir n'est pas additionné ;
//      la livraison est signalée.

const D = Decimal.clone({ precision: 60 });

export const MOTIF_LIVRAISON_RESTAURANT = "LIVRAISON_RESTAURANT";

// ─── Entrées (dénormalisées par le chargeur) ─────────────────────────────────

/**
 * Un article du catalogue rattaché à un article du restaurant (plusieurs marques de beurre pour un
 * « Beurre ») : son unité et sa contenance servent à convertir ses livraisons, et le comptage du
 * restaurant, dans SON unité.
 */
export type ArticleCatalogueLie = {
  id: string; unite: string | null;
  /** Contenance de l'article (bouteille de 75 cl, beurre de 250 g) : un comptage en cl ou en g s'y convertit. */
  contenance?: string | null; contenanceUnite?: string | null;
  /** Nom affiché (contenance comprise), pour les messages ; absent, l'identifiant ne se lit pas. */
  designation?: string;
  /** Domaine du catalogue : dit l'espace (Cuisine / Bar) quand l'article est rattaché aux deux. */
  domaine?: string | null;
};

/**
 * Article du restaurant ACTIF. `unite` : unité de comptage ; `rattaches` : les articles du catalogue
 * qui l'alimentent (zéro, un ou PLUSIEURS — disponibilité des plats, livraisons).
 */
export type ArticleRestoSR = {
  id: string; designation: string; espace: "CUISINE" | "BAR"; unite: string | null; rattaches: ArticleCatalogueLie[];
  /** Désactivé depuis (chargé seulement pour une période passée où il a un comptage ou une livraison). */
  inactif?: boolean;
};

/** L'article du restaurant est-il rattaché à cet article du catalogue ? */
export const estRattacheA = (a: ArticleRestoSR, articleStockId: string) => a.rattaches.some((r) => r.id === articleStockId);
/** Comptage saisi au restaurant (dates PURES AAAA-MM-JJ, quantités en texte pleine précision). */
export type ComptageSR = { articleRestoId: string; date: string; quantite: string };
/** Sortie du dépôt, dans l'unité de l'article du catalogue. */
export type LivraisonSR = {
  id: string; articleStockId: string; designation: string; uniteCatalogue: string | null;
  contenanceCatalogue?: string | null; contenanceUniteCatalogue?: string | null;
  date: string; quantite: string; categorieSortie: string | null;
  /** Domaine de l'article du catalogue : dit l'espace (Cuisine / Bar) quand il est rattaché aux deux. */
  domaine?: string | null;
};

/**
 * Espace du restaurant d'un domaine du catalogue (« Cuisine (nourriture) », « Bar (boissons) »).
 * Tout autre domaine (AUTRE…) ne désigne aucun espace.
 */
/**
 * L'article du CATALOGUE tel que la conversion le voit (unité ET contenance) : c'est lui, jamais une
 * simple chaîne d'unité, qui passe à `convertirVersUniteArticle` / `convertirDepuisUniteArticle`.
 */
export function articleCatalogue(x: { uniteCatalogue?: string | null; contenanceCatalogue?: string | null; contenanceUniteCatalogue?: string | null }): UniteArticle {
  return { unite: x.uniteCatalogue ?? null, contenance: x.contenanceCatalogue ?? null, contenanceUnite: x.contenanceUniteCatalogue ?? null };
}

export function espaceDuDomaine(domaine: string | null | undefined): "CUISINE" | "BAR" | null {
  return domaine === "NOURRITURE" ? "CUISINE" : domaine === "BOISSON" ? "BAR" : null;
}
/**
 * `debutLivraisons` (AAAA-MM-JJ) : les livraisons ne sont chargées qu'à partir de cette date (plus
 * celles d'après le dernier comptage de chaque article compté). Un article SANS comptage n'estime
 * donc son stock qu'à partir d'elle — jamais sur un historique chargé à moitié.
 */
export type EntreesStockResto = {
  articles: ArticleRestoSR[]; comptages: ComptageSR[]; livraisons: LivraisonSR[]; debutLivraisons?: string;
  /** Consommation des ventes × fiches (voir `ventes-consommation.ts`) depuis le plus ancien comptage ; absent = ventes non chargées. */
  consoVentes?: ConsoVenteSR[];
  /** Ventes de fiches incomplètes : le théorique des articles concernés est « À vérifier ». */
  ventesAVerifier?: VenteAVerifierSR[];
};

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

/** Livraison additionnée : `articleStockId` = la marque livrée ; `quantiteCatalogue` dans SON unité, `quantiteResto` dans celle du restaurant. */
export type LivraisonRecue = { livraisonId: string; articleStockId: string; date: string; quantiteCatalogue: string; quantiteResto: string };

/** Consommation des ventes retirée du stock : `quantiteResto` dans l'unité du restaurant. */
export type VenteRetiree = { date: string; ficheId: string; ficheNom: string; articleStockId: string; quantiteCatalogue: string; quantiteResto: string };

/** Vente non déductible du stock théorique d'un article du restaurant, et pourquoi. */
export type SignalementVente = {
  date: string; ficheNom: string;
  motif: MotifUnite | "A_REPARTIR" | "FICHE_INCOMPLETE";
  /** Texte lisible : « Brioche (12/10) : Crème : quantité non renseignée ». */
  texte: string;
};

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
  /** Consommation des ventes retirée depuis le dernier comptage (vide : aucune, ou ventes non chargées). */
  ventesDepuis: VenteRetiree[];
  /** Somme des ventes retirées, unité du restaurant ; null : aucune. */
  vendu: string | null;
  /** Ventes depuis le comptage qu'on ne sait pas déduire : le stock ci-dessus n'est alors PAS fiable — « À vérifier ». */
  ventesAVerifier: SignalementVente[];
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
  articleStockId: string, catalogue: UniteArticle, articles: ArticleRestoSR[], domaine?: string | null,
): EtatRattachement {
  const candidats = articles.filter((a) => estRattacheA(a, articleStockId));
  if (candidats.length === 0) return { etat: "NON_RATTACHE" };
  let r = candidats[0]!;
  if (candidats.length > 1) {
    const espace = espaceDuDomaine(domaine);
    const dansEspace = espace ? candidats.filter((c) => c.espace === espace) : [];
    if (dansEspace.length !== 1) return { etat: "A_REPARTIR", articleRestoIds: (dansEspace.length > 1 ? dansEspace : candidats).map((c) => c.id) };
    r = dansEspace[0]!;
  }
  if (uniteManquante(r.unite)) return { etat: "UNITE_RESTO_MANQUANTE", articleRestoId: r.id };
  if (uniteManquante(catalogue.unite)) return { etat: "UNITE_CATALOGUE_MANQUANTE", articleRestoId: r.id };
  if (convertirDepuisUniteArticle(1, catalogue, r.unite ?? "") === null) return { etat: "UNITE_INCOMPATIBLE", articleRestoId: r.id };
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
  ventes: Map<string, VenteRetiree[]>; // ventes × fiches, idem
  ventesSignalees: Map<string, SignalementVente[]>; // idem
};

const INDEX = new WeakMap<EntreesStockResto, Index>();
const parDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const pousser = <T>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };

function indexer(e: EntreesStockResto): Index {
  const deja = INDEX.get(e);
  if (deja) return deja;
  const idx: Index = { comptages: new Map(), recues: new Map(), signalees: new Map(), nonRattachees: [], ventes: new Map(), ventesSignalees: new Map() };
  const noms = new Map(e.articles.map((a) => [a.id, a.designation]));
  const unites = new Map(e.articles.map((a) => [a.id, a.unite]));
  for (const c of e.comptages) if (noms.has(c.articleRestoId)) pousser(idx.comptages, c.articleRestoId, c);

  for (const l of e.livraisons) {
    if (l.categorieSortie !== MOTIF_LIVRAISON_RESTAURANT) continue;
    const r = etatRattachementLivraison(l.articleStockId, articleCatalogue(l), e.articles, l.domaine);
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
      const quantiteResto = convertirDepuisUniteArticle(l.quantite, articleCatalogue(l), unites.get(r.articleRestoId) ?? "")!;
      pousser(idx.recues, r.articleRestoId, { livraisonId: l.id, articleStockId: l.articleStockId, date: l.date, quantiteCatalogue: l.quantite, quantiteResto });
    }
  }

  // Ventes × fiches : même rattachement et mêmes conversions que les livraisons.
  const jjmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  for (const c of e.consoVentes ?? []) {
    const r = etatRattachementLivraison(c.articleStockId, articleCatalogue(c), e.articles, c.domaine);
    const signal = (motif: SignalementVente["motif"], articleRestoId: string, detail: string) =>
      pousser(idx.ventesSignalees, articleRestoId, { date: c.date, ficheNom: c.ficheNom, motif, texte: `${c.ficheNom} (${jjmm(c.date)}) : ${c.designation}, ${detail}` });
    if (r.etat === "NON_RATTACHE") continue; // ingrédient sans stock au restaurant : rien à retirer
    if (r.etat === "A_REPARTIR") { for (const id of r.articleRestoIds) signal("A_REPARTIR", id, LIBELLE_SIGNALEMENT.A_REPARTIR); continue; }
    if (r.etat !== "OK") { signal(r.etat, r.articleRestoId, LIBELLE_SIGNALEMENT[r.etat]); continue; }
    const quantiteResto = convertirDepuisUniteArticle(c.quantite, articleCatalogue(c), unites.get(r.articleRestoId) ?? "")!;
    pousser(idx.ventes, r.articleRestoId, { date: c.date, ficheId: c.ficheId, ficheNom: c.ficheNom, articleStockId: c.articleStockId, quantiteCatalogue: c.quantite, quantiteResto });
  }
  for (const v of e.ventesAVerifier ?? []) {
    for (const art of v.articles) {
      const candidats = e.articles.filter((a) => estRattacheA(a, art.id));
      const espace = espaceDuDomaine(art.domaine);
      const dansEspace = espace ? candidats.filter((c) => c.espace === espace) : [];
      for (const c of dansEspace.length === 1 ? dansEspace : candidats) {
        pousser(idx.ventesSignalees, c.id, { date: v.date, ficheNom: v.ficheNom, motif: "FICHE_INCOMPLETE", texte: `${v.ficheNom} (${jjmm(v.date)}) : fiche incomplète${v.raisons.length > 0 ? ` — ${v.raisons.join(" ; ")}` : ""}` });
      }
    }
  }
  for (const m of [idx.comptages, idx.recues, idx.signalees, idx.ventes, idx.ventesSignalees] as Map<string, { date: string }[]>[]) for (const l of m.values()) l.sort(parDate);
  idx.nonRattachees.sort(parDate);
  INDEX.set(e, idx);
  return idx;
}

// ─── API ─────────────────────────────────────────────────────────────────────

function stockDe(idx: Index, articleRestoId: string, jour: string, debutLivraisons?: string, avecVentes = true): StockTheorique {
  const comptes = (idx.comptages.get(articleRestoId) ?? []).filter((c) => c.date <= jour);
  const dernier = comptes.at(-1) ?? null;
  // Fenêtre (C, J] : une livraison du jour du comptage est déjà dans le chiffre compté.
  // Sans comptage : seulement les livraisons de la période chargée (`debutLivraisons`).
  const dansFenetre = (d: string) => d <= jour && (dernier === null ? !debutLivraisons || d >= debutLivraisons : d > dernier.date);
  const livraisonsDepuis = (idx.recues.get(articleRestoId) ?? []).filter((l) => dansFenetre(l.date));
  const signalements = (idx.signalees.get(articleRestoId) ?? []).filter((s) => dansFenetre(s.date));

  // Ventes × fiches : seulement depuis un COMPTAGE (borne ouverte en C : le comptage de fin de journée les contient).
  const fenetreVentes = (d: string) => dernier !== null && d > dernier.date && d <= jour;
  const ventesDepuis = avecVentes ? (idx.ventes.get(articleRestoId) ?? []).filter((v) => fenetreVentes(v.date)) : [];
  const ventesAVerifier = avecVentes ? (idx.ventesSignalees.get(articleRestoId) ?? []).filter((v) => fenetreVentes(v.date)) : [];
  const vendu = ventesDepuis.length === 0 ? null : ventesDepuis.reduce((t, v) => t.plus(v.quantiteResto), new D(0)).toString();

  let stock: string | null = null;
  if (dernier !== null || livraisonsDepuis.length > 0) {
    stock = livraisonsDepuis.reduce((t, l) => t.plus(l.quantiteResto), new D(dernier?.quantite ?? 0)).minus(vendu ?? 0).toString();
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
    ventesDepuis,
    vendu,
    ventesAVerifier,
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
      /**
       * Date (AAAA-MM-JJ) du dernier comptage AVANT ce jour quand ce n'est pas la veille : la
       * consommation couvre alors `nbJours` jours (veille non comptée), pas un seul. null = la veille
       * est comptée (ou aucun comptage : voir `veilleEstimee`).
       */
      depuis: string | null;
      /** Nombre de jours que couvre la consommation (1 = la veille était comptée). */
      nbJours: number;
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
  // La consommation RÉELLE ne retire jamais les ventes : c'est précisément ce qu'on lui compare (contrôle des écarts).
  const veille = stockDe(idx, articleRestoId, veilleDe(jour), e.debutLivraisons, false);
  if (veille.stock === null) return { etat: "INCONNUE", raison: "STOCK_VEILLE_INCONNU" };
  const recu = recuDuDepot(e, articleRestoId, jour);
  if (veille.signalements.length > 0 || recu.signalements.length > 0) return { etat: "INCONNUE", raison: "LIVRAISON_NON_COMPTEE" };
  const quantite = new D(veille.stock).plus(recu.quantite ?? 0).minus(compte.quantite);
  // Veille non comptée : le dernier comptage est plus ancien, la consommation couvre tous les jours depuis.
  const dernier = veille.dernierComptage?.date ?? null;
  const nbJours = dernier === null ? 1 : Math.round((Date.parse(`${jour}T00:00:00Z`) - Date.parse(`${dernier}T00:00:00Z`)) / 86_400_000);
  const plusieursJours = dernier !== null && nbJours > 1;
  return {
    etat: "CONNUE",
    quantite: quantite.toString(),
    negative: quantite.isNegative() && !quantite.isZero(),
    stockVeille: veille.stock,
    recu: recu.quantite ?? "0",
    compte: compte.quantite,
    veilleEstimee: veille.aucunComptage,
    depuis: plusieursJours ? dernier : null,
    nbJours: plusieursJours ? nbJours : 1,
  };
}

type Connue = Extract<ConsommationReelle, { etat: "CONNUE" }>;

/** Consommation APPROXIMATIVE (« ≈ ») : veille estimée sans comptage, ou calculée sur plusieurs jours. */
export const consoApproximative = (c: Connue) => c.veilleEstimee || c.depuis !== null;

/** « depuis le 12/10 (3 jours) » : ce que couvre une consommation dont la veille n'a pas été comptée ; null sinon. */
export function mentionDepuis(c: Connue): string | null {
  if (c.depuis === null) return null;
  return `depuis le ${c.depuis.slice(8, 10)}/${c.depuis.slice(5, 7)} (${c.nbJours} jours)`;
}

// ─── Contrôle : consommation RÉELLE vs THÉORIQUE (ventes × fiches) sur une période ──────────────────

/**
 * Consommation d'un article du restaurant sur une PÉRIODE [debut, fin] (dates pures, bornes incluses),
 * mesurée entre deux comptages de FIN DE JOURNÉE :
 *   C0 = dernier comptage ≤ veille de `debut` (à défaut, le premier de la période) ;
 *   C1 = dernier comptage de la période ;
 *   RÉELLE    = compté(C0) + livraisons additionnées (C0, C1] − compté(C1)   (jamais de ventes dedans) ;
 *   THÉORIQUE = Σ ventes × fiches techniques (C0, C1]                          (unité du restaurant) ;
 *   ÉCART     = réelle − théorique : positif = consommé en PLUS de ce que les ventes expliquent
 *               (perte, gaspillage, vol, fiche trop économe) ; négatif = consommé en moins.
 * Les deux grandeurs couvrent EXACTEMENT la même fenêtre (C0, C1], qui peut déborder la période si le
 * comptage de départ est plus ancien : elle est rendue. Signal seulement — rien n'est écrit.
 * Inconnue (jamais 0) : pas de comptage utilisable, livraison non additionnable, vente non déductible.
 */
export type EcartPeriode =
  | {
      etat: "CONNUE"; de: string; a: string; nbJours: number;
      compteDebut: string; compteFin: string; recu: string; reelle: string; theorique: string; ecart: string;
      /** Ventes retirées, par fiche (diagnostic : quelle fiche explique le théorique). */
      parFiche: { ficheId: string; ficheNom: string; quantiteResto: string }[];
    }
  | { etat: "INCONNUE"; raison: "PAS_DE_COMPTAGE" | "UN_SEUL_COMPTAGE" | "LIVRAISON_NON_COMPTEE" | "VENTES_A_VERIFIER"; detail: string[] };

export const LIBELLE_ECART_INCONNU: Record<Extract<EcartPeriode, { etat: "INCONNUE" }>["raison"], string> = {
  PAS_DE_COMPTAGE: "aucun comptage dans la période",
  UN_SEUL_COMPTAGE: "un seul comptage : rien à comparer",
  LIVRAISON_NON_COMPTEE: "livraison non additionnée (à répartir ou unité incompatible)",
  VENTES_A_VERIFIER: "ventes non déductibles (fiche incomplète ou unité inconvertible)",
};

export function ecartVentesConsommation(e: EntreesStockResto, articleRestoId: string, debut: string, fin: string): EcartPeriode {
  const idx = indexer(e);
  const comptes = idx.comptages.get(articleRestoId) ?? [];
  const veille = veilleDe(debut);
  const c1 = comptes.filter((c) => c.date >= debut && c.date <= fin).at(-1) ?? null;
  if (c1 === null) return { etat: "INCONNUE", raison: "PAS_DE_COMPTAGE", detail: [] };
  const c0 = comptes.filter((c) => c.date <= veille).at(-1) ?? comptes.find((c) => c.date >= debut && c.date < c1.date) ?? null;
  if (c0 === null) return { etat: "INCONNUE", raison: "UN_SEUL_COMPTAGE", detail: [] };
  const dansFenetre = (d: string) => d > c0.date && d <= c1.date;
  const signalements = (idx.signalees.get(articleRestoId) ?? []).filter((x) => dansFenetre(x.date));
  if (signalements.length > 0) return { etat: "INCONNUE", raison: "LIVRAISON_NON_COMPTEE", detail: signalements.map((x) => `${x.designation} (${x.date.slice(8, 10)}/${x.date.slice(5, 7)}) : ${LIBELLE_SIGNALEMENT[x.motif]}`) };
  const aVerifier = (idx.ventesSignalees.get(articleRestoId) ?? []).filter((x) => dansFenetre(x.date));
  if (aVerifier.length > 0) return { etat: "INCONNUE", raison: "VENTES_A_VERIFIER", detail: [...new Set(aVerifier.map((x) => x.texte))] };
  const recues = (idx.recues.get(articleRestoId) ?? []).filter((l) => dansFenetre(l.date));
  const ventes = (idx.ventes.get(articleRestoId) ?? []).filter((v) => dansFenetre(v.date));
  const recu = recues.reduce((t, l) => t.plus(l.quantiteResto), new D(0));
  const theorique = ventes.reduce((t, v) => t.plus(v.quantiteResto), new D(0));
  const reelle = new D(c0.quantite).plus(recu).minus(c1.quantite);
  const parFicheMap = new Map<string, { ficheId: string; ficheNom: string; quantiteResto: InstanceType<typeof D> }>();
  for (const v of ventes) {
    const x = parFicheMap.get(v.ficheId);
    if (x) x.quantiteResto = x.quantiteResto.plus(v.quantiteResto); else parFicheMap.set(v.ficheId, { ficheId: v.ficheId, ficheNom: v.ficheNom, quantiteResto: new D(v.quantiteResto) });
  }
  return {
    etat: "CONNUE", de: c0.date, a: c1.date, nbJours: Math.round((Date.parse(`${c1.date}T00:00:00Z`) - Date.parse(`${c0.date}T00:00:00Z`)) / 86_400_000),
    compteDebut: c0.quantite, compteFin: c1.quantite, recu: recu.toString(), reelle: reelle.toString(), theorique: theorique.toString(), ecart: reelle.minus(theorique).toString(),
    parFiche: [...parFicheMap.values()].map((x) => ({ ...x, quantiteResto: x.quantiteResto.toString() })).sort((a, b) => new D(b.quantiteResto).comparedTo(a.quantiteResto)),
  };
}

// ─── Part du restaurant dans la disponibilité des plats ──────────────────────

/**
 * Stock théorique du restaurant par article du CATALOGUE rattaché (chacun de ceux d'un article du restaurant), dans l'unité de cet article (décision du
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
  const typeVendu = (x: string | null | undefined, y: InstanceType<typeof D> | null) => (x == null && y === null ? null : new D(x ?? 0).plus(y ?? 0).toString());
  for (const a of e.articles) {
    if (a.rattaches.length === 0) continue;
    const s = parArticle.get(a.id)!;
    if (s.stock === null && s.signalements.length === 0) continue; // ni comptage ni livraison : n'apporte rien
    // UNE part par article du catalogue rattaché : le stock du restaurant (en unité du restaurant) ramené à
    // l'unité de CET article. Les marques d'un même article du restaurant partagent donc le même stock.
    for (const lie of a.rattaches) {
      const cat = lie.id;
      const deja = res.get(cat);
      if (gravite(deja) === 2) continue;
      if (s.signalements.some((x) => x.motif === "A_REPARTIR")) { res.set(cat, { etat: "A_REPARTIR", articleResto: a.designation }); continue; }
      if (s.ventesAVerifier.length > 0) { res.set(cat, { etat: "VENTES_A_VERIFIER", articleResto: a.designation, raison: s.ventesAVerifier.map((v) => v.texte).join(" ; ") }); continue; }
      const article = articleCatalogueLie(lie);
      const compte = s.dernierComptage === null ? "0" : convertirVersUniteArticle(s.dernierComptage.quantite, a.unite ?? "", article);
      // Livraisons reçues : celles de CET article telles que sorties du dépôt (déjà dans son unité, sans
      // aller-retour) ; celles d'une autre marque, converties via l'unité du restaurant.
      const recuesConverties = s.livraisonsDepuis.map((l) => (l.articleStockId === cat ? l.quantiteCatalogue : convertirVersUniteArticle(l.quantiteResto, a.unite ?? "", article)));
      // Ventes retirées (unité du restaurant → unité de CET article), comme le comptage.
      const venduConverti = s.vendu === null ? null : convertirVersUniteArticle(s.vendu, a.unite ?? "", article);
      if (compte === null || recuesConverties.some((q) => q === null) || (s.vendu !== null && venduConverti === null) || s.signalements.some((x) => x.motif !== "A_REPARTIR")) {
        res.set(cat, { etat: "UNITE_NON_CONVERTIBLE", articleResto: a.designation });
        continue;
      }
      const recu = s.livraisonsDepuis.length === 0 ? null : recuesConverties.reduce<InstanceType<typeof D>>((t, q) => t.plus(q!), new D(0));
      const vendu = venduConverti === null ? null : new D(venduConverti);
      const quantite = new D(compte).plus(recu ?? 0).minus(vendu ?? 0);
      const cumul = (x: string | null | undefined, y: InstanceType<typeof D> | null) => (x == null && y === null ? null : new D(x ?? 0).plus(y ?? 0).toString());
      if (deja === undefined) {
        res.set(cat, s.dernierComptage === null
          ? { etat: "ESTIME", quantite: quantite.toString(), recu: recu === null ? null : recu.toString() }
          : { etat: "OK", quantite: quantite.toString(), dateComptage: s.dernierComptage.date, recu: recu === null ? null : recu.toString(), vendu: vendu === null ? null : vendu.toString() });
        continue;
      }
      if (deja.etat !== "OK" && deja.etat !== "ESTIME") continue;
      const somme = new D(deja.quantite).plus(quantite).toString();
      if (deja.etat === "ESTIME" || s.dernierComptage === null) {
        res.set(cat, { etat: "ESTIME", quantite: somme, recu: cumul(deja.recu, recu) });
      } else {
        const date = deja.dateComptage < s.dernierComptage.date ? deja.dateComptage : s.dernierComptage.date;
        res.set(cat, { etat: "OK", quantite: somme, dateComptage: date, recu: cumul(deja.recu, recu), vendu: typeVendu(deja.vendu, vendu) });
      }
    }
  }
  return res;
}

/** L'article du catalogue rattaché tel que la conversion le voit (unité + contenance). */
export const articleCatalogueLie = (l: ArticleCatalogueLie): UniteArticle => ({ unite: l.unite, contenance: l.contenance ?? null, contenanceUnite: l.contenanceUnite ?? null });

/**
 * Dépôt « mutualisé » des articles du catalogue rattachés à un même article du restaurant (plusieurs
 * marques de beurre) : pour chaque article rattaché, la SOMME des stocks du dépôt de toutes les
 * marques de son article du restaurant, ramenée à SON unité (en passant par l'unité du restaurant :
 * 250 g d'une marque et 500 g d'une autre se comptent en kg). Rien n'est deviné :
 *  - `negatif` : l'un des stocks du dépôt est NÉGATIF — la somme ne doit pas le masquer ;
 *  - `inconvertibles` : marques dont l'unité ne se ramène pas à celle de l'article — non additionnées,
 *    annoncées (le calcul en tient compte : « À vérifier »).
 * Un article rattaché seul garde son dépôt tel quel ; un article sans ligne de stock et sans marque
 * soeur n'a pas d'entrée (dépôt inconnu, « — »). `depots` : `Stock.quantite` par article, en texte.
 */
export type DepotMutualise = { depot: string | null; negatif: boolean; inconvertibles: string[] };
export function depotsMutualises(articles: ArticleRestoSR[], depots: ReadonlyMap<string, string>): Map<string, DepotMutualise> {
  // Les marques sœurs d'un article du catalogue : celles de TOUS les articles du restaurant auxquels il est rattaché.
  const soeurs = new Map<string, Map<string, { lie: ArticleCatalogueLie; uniteResto: string | null }>>();
  for (const a of articles) {
    for (const lie of a.rattaches) {
      const m = soeurs.get(lie.id) ?? new Map();
      for (const autre of a.rattaches) if (!m.has(autre.id)) m.set(autre.id, { lie: autre, uniteResto: a.unite });
      soeurs.set(lie.id, m);
    }
  }
  const res = new Map<string, DepotMutualise>();
  for (const [cat, marques] of soeurs) {
    const moi = marques.get(cat)!;
    let total: InstanceType<typeof D> | null = null;
    let negatif = false;
    const inconvertibles: string[] = [];
    for (const [id, { lie, uniteResto }] of marques) {
      const brut = depots.get(id);
      if (brut === undefined) continue;
      const q = new D(brut);
      if (q.isNegative() && !q.isZero()) negatif = true;
      if (id === cat) { total = (total ?? new D(0)).plus(q); continue; }
      // Marque sœur : son stock → unité du restaurant → unité de l'article.
      const enResto = convertirDepuisUniteArticle(brut, articleCatalogueLie(lie), uniteResto ?? "");
      const enMoi = enResto === null ? null : convertirVersUniteArticle(enResto, uniteResto ?? "", articleCatalogueLie(moi.lie));
      if (enMoi === null) { inconvertibles.push(lie.designation ?? id); continue; }
      total = (total ?? new D(0)).plus(enMoi);
    }
    res.set(cat, { depot: total === null ? null : total.toString(), negatif, inconvertibles });
  }
  return res;
}
