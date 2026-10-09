// Passerelle entre les données d'écran et le moteur de coût pur (`src/lib/fiches/cout.ts`).
//
// Ce module ne calcule RIEN : il assemble les objets `FicheCalc`/`IngredientCalc` attendus par
// `calculerCout`, et met en forme ce que le moteur renvoie. Toute formule de coût, de marge ou de
// prix reste dans le moteur — un nom = une formule, écrite à un seul endroit.
//
// Les montants et quantités voyagent en TEXTE (et non en `number`) : c'est la seule forme à la fois
// sérialisable vers un composant client ET lisible par Decimal sans passer par le flottant.

import type { FicheCalc, IngredientCalc, MotifSansPrix } from "@/lib/fiches/cout";
import {
  calculerDisponibilite, libelleRaison, recetteACompleter,
  type ArticleDispo, type EtatDispo, type FicheDispo, type ResultatDisponibilite, type StockArticle,
} from "@/lib/fiches/disponibilite";
import { formaterNombre } from "@/lib/montant";
import { lireNombreSaisi, versSaisie } from "@/lib/nombre";
import { libelleArticle, type ArticleLibelle } from "@/lib/libelle-article";

/**
 * Article du catalogue, réduit à ce dont la fiche a besoin (prix en texte, pleine précision).
 * `uniteParCarton` n'y figure pas volontairement : le prix de vérité est le prix à l'unité, on ne
 * re-dérive jamais un prix depuis le carton (spec §12.5).
 */
export type ArticleOption = {
  id: string;
  designation: string;
  unite: string;
  /** Prix en DOLLARS lu par le moteur (article en francs : converti au taux du jour, voir charger-fiche). */
  prixUnitaireUSD: string | null;
  /** Article au prix en FRANCS : son prix tel que saisi ; le dollar ci-dessus est « ≈ ». */
  prixApprox?: boolean;
  prixSaisi?: { devise: "USD" | "CDF"; montant: string } | null;
  actif: boolean;
  /** Contenance d'une unité comptée à l'unité (bouteille de 75 cl) : texte pleine précision, null = inconnue. */
  contenance?: string | null;
  contenanceUnite?: string | null;
  /** Textes où chercher l'article en tapant (sélecteur de la fiche) : jamais utilisés par le calcul. */
  nomCourt?: string | null;
  code?: string | null;
};

/** Une ligne d'ingrédient telle qu'elle s'affiche et s'édite. */
export type LigneFiche = {
  id: string;
  articleId: string | null;
  sousFicheId: string | null;
  unite: string;
  quantite: string;
  ordre: number;
};

/** Une fiche telle qu'elle s'affiche et s'édite (tout en texte : sérialisable tel quel). */
export type FicheVue = {
  id: string;
  nom: string;
  categorie: string;
  type: string;
  nbPortions: number;
  tauxTVA: string;
  prixVenteTTC: string;
  coefficientMargeCible: string;
  estSousRecette: boolean;
  rendementQuantite: string;
  rendementUnite: string;
  recette: string;
  actif: boolean;
  /** Photo du plat (référence de dressage) — pure mise en forme, aucune incidence sur le coût. */
  photoUrl: string | null;
  lignes: LigneFiche[];
};

/**
 * La fiche telle qu'elle est SAISIE à l'écran : mêmes champs que `FicheVue`, mais chaque nombre est
 * le texte tapé (« 2,5 », « 1.500 »), à la française. `FicheVue` reste en notation canonique
 * (« 2.5 ») : c'est la seule que lisent les moteurs (Decimal) et le PDF.
 */
export type FicheSaisie = Omit<FicheVue, "nbPortions"> & { nbPortions: string };

/** Texte canonique (« 2.125 », Decimal de la base) → texte de saisie (« 2,125 »). Vide reste vide. */
const canoniqueVersSaisie = (t: string): string => {
  if (!t.trim()) return "";
  const n = Number(t);
  return Number.isFinite(n) ? versSaisie(n) : t;
};

/**
 * Texte de saisie → texte canonique pour les moteurs. Une saisie ILLISIBLE devient « illisible » :
 * les moteurs la refusent (quantité invalide) au lieu de lire « 2.5 » tel quel — jamais un zéro.
 */
const saisieVersCanonique = (t: string): string => {
  if (!t.trim()) return "";
  const n = lireNombreSaisi(t);
  return n === null ? "illisible" : String(n);
};

/** Fiche enregistrée → fiche de saisie (point de départ du formulaire). */
export function vueEnSaisie(v: FicheVue): FicheSaisie {
  return {
    ...v,
    nbPortions: String(v.nbPortions),
    tauxTVA: canoniqueVersSaisie(v.tauxTVA),
    prixVenteTTC: canoniqueVersSaisie(v.prixVenteTTC),
    coefficientMargeCible: canoniqueVersSaisie(v.coefficientMargeCible),
    rendementQuantite: canoniqueVersSaisie(v.rendementQuantite),
    lignes: v.lignes.map((l) => ({ ...l, quantite: canoniqueVersSaisie(l.quantite) })),
  };
}

/**
 * Fiche de saisie → fiche pour les moteurs. Portions : un ENTIER, sinon NaN (« portions
 * inexploitables », déjà géré par l'écran et les moteurs).
 */
export function vueDepuisSaisie(s: FicheSaisie): FicheVue {
  const portions = lireNombreSaisi(s.nbPortions);
  return {
    ...s,
    nbPortions: portions !== null && Number.isInteger(portions) ? portions : Number.NaN,
    tauxTVA: saisieVersCanonique(s.tauxTVA),
    prixVenteTTC: saisieVersCanonique(s.prixVenteTTC),
    coefficientMargeCible: saisieVersCanonique(s.coefficientMargeCible),
    rendementQuantite: saisieVersCanonique(s.rendementQuantite),
    lignes: s.lignes.map((l) => ({ ...l, quantite: saisieVersCanonique(l.quantite) })),
  };
}

/** Libellé d'une ligne : le nom AFFICHÉ de l'article (contenance comprise), celui de la sous-recette, ou un repère de rang. */
export function nomLigne(
  ligne: LigneFiche,
  index: number,
  articles: Map<string, ArticleLibelle>,
  fiches: Map<string, { nom: string }>,
): string {
  if (ligne.articleId) { const a = articles.get(ligne.articleId); return a ? libelleArticle(a) : "Article supprimé du catalogue"; }
  if (ligne.sousFicheId) return fiches.get(ligne.sousFicheId)?.nom ?? "Sous-recette introuvable";
  return `Ingrédient n°${index + 1}`;
}

/** Construit l'entrée du moteur pour une fiche (les sous-recettes restent référencées par id). */
export function versFicheCalc(
  vue: FicheVue,
  articles: Map<string, ArticleOption>,
  fiches: Map<string, { nom: string }>,
): FicheCalc {
  const ingredients: IngredientCalc[] = vue.lignes.map((l, i) => {
    const art = l.articleId ? articles.get(l.articleId) : undefined;
    return {
      id: l.id,
      nom: nomLigne(l, i, articles, fiches),
      unite: l.unite,
      quantite: l.quantite,
      // Un article référencé mais absent du catalogue reste `null` : le moteur l'annonce
      // (SANS_SOURCE) au lieu de le valoriser à zéro.
      article: art ? { prixUnitaireUSD: art.prixUnitaireUSD, unite: art.unite, contenance: art.contenance ?? null, contenanceUnite: art.contenanceUnite ?? null } : null,
      sousFicheId: l.sousFicheId,
    };
  });

  return {
    id: vue.id,
    nom: vue.nom,
    nbPortions: vue.nbPortions,
    tauxTVA: vue.tauxTVA || "0",
    prixVenteTTC: vue.prixVenteTTC || null,
    coefficientMargeCible: vue.coefficientMargeCible || null,
    estSousRecette: vue.estSousRecette,
    rendementQuantite: vue.rendementQuantite || null,
    rendementUnite: vue.rendementUnite || null,
    ingredients,
  };
}

/**
 * Contexte du moteur : toutes les fiches, indexées par identifiant. C'est lui qui résout les
 * sous-recettes à n'importe quelle profondeur (et permet au moteur de repérer les cycles).
 */
export function construireContexte(
  vues: FicheVue[],
  articles: Map<string, ArticleOption>,
): { fiches: Map<string, FicheCalc> } {
  const noms = new Map(vues.map((v) => [v.id, { nom: v.nom }]));
  return { fiches: new Map(vues.map((v) => [v.id, versFicheCalc(v, articles, noms)])) };
}

// ─── Mise en forme (aucun calcul) ────────────────────────────────────────────

/** Pourquoi une ligne n'a pas de coût — en français, pour que le Stock sache quoi corriger. */
export const MOTIF_LABEL: Record<MotifSansPrix, string> = {
  PRIX_ABSENT: "Aucun prix d'achat au catalogue",
  PRIX_NUL: "Prix à 0 au catalogue (à corriger, ce n'est pas gratuit)",
  UNITE_INCONVERTIBLE: "Unité de recette incompatible avec l'unité d'achat",
  QUANTITE_INVALIDE: "Quantité invalide",
  QUANTITE_ABSENTE: "Quantité à 0 : non renseignée (à saisir, ce n'est pas « rien »)",
  SANS_SOURCE: "Ni article du stock ni sous-recette",
  SOUS_FICHE_INTROUVABLE: "Sous-recette introuvable",
  RENDEMENT_ABSENT: "Sous-recette sans rendement renseigné",
  UNITE_RENDEMENT_INCOHERENTE: "Rendement de la sous-recette dans une autre unité que la consommation",
  COUT_INDETERMINE: "Sous-recette dont aucun ingrédient n'est valorisé",
  CYCLE: "Boucle : la recette se contient elle-même",
};

// `pct` et `coef` servent l'écran ET le PDF des fiches. Jamais `toLocaleString("fr-FR")`, dont
// l'espace fine insécable (U+202F) n'existe pas dans la police des PDF (un taux de marge de
// 1 150 % d'un cocktail sortirait « barré ») : `formaterNombre`, puis l'espace INSÉCABLE ordinaire
// (U+00A0) — l'écran ne coupe jamais « 1 150 % » en fin de ligne, et Optima possède ce caractère
// (le PDF le ramène de toute façon à une espace simple, par `texteSurPdf`).
const insecable = (s: string) => s.replace(/ /g, "\u00A0");

/** Ratio (0,875) → « 87,5 % ». Ce n'est PAS un montant : ni `usd()` ni `arrondirCentime` ici. */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return insecable(`${formaterNombre(v * 100, { maximumFractionDigits: 1 })} %`);
}

/** Coefficient (8) → « × 8 ». Ce n'est pas un montant non plus. */
export function coef(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return insecable(`× ${formaterNombre(v, { maximumFractionDigits: 2 })}`);
}

/**
 * Étiquette d'un indicateur de prix : dit son ORIGINE (conseillé depuis le coefficient cible, ou
 * dérivé d'un prix décidé) et sa COMPLÉTUDE (`note` : « sur coût partiel », « sur coût inconnu »,
 * ou rien). Deux questions différentes, deux mentions — c'est ce qui empêche de lire un prix
 * arrêté là où il n'y a qu'une cible. La note est passée par l'appelant (`noteCoutIncomplet`).
 * Partagée par l'écran de la fiche et son PDF : même libellé aux deux endroits.
 */
export function etiquettePrix(base: string, conseille: boolean, note: string | null): string {
  const notes = [conseille ? "conseillé" : null, note].filter(Boolean);
  return notes.length ? `${base} (${notes.join(", ")})` : base;
}

/**
 * Note des indicateurs de prix d'une fiche au coût incomplet. `incomplet` couvre trois causes :
 * ingrédients non valorisés, fiche SANS ingrédient (coût inconnu, pas nul), portions
 * inexploitables. Seule la fiche vide est « sur coût inconnu ».
 */
export function noteCoutIncomplet(incomplet: boolean, nbIngredients: number): string | null {
  return !incomplet ? null : nbIngredients === 0 ? "sur coût inconnu" : "sur coût partiel";
}

export const TYPE_LABEL: Record<string, string> = { PLAT: "Plat", BAR: "Bar" };

// ─── Disponibilité selon le stock (passerelle vers `src/lib/fiches/disponibilite.ts`) ────────────

/** Entrée du moteur de disponibilité pour une fiche (mêmes libellés que le coût). */
export function versFicheDispo(
  vue: FicheVue,
  articles: Map<string, ArticleDispo>,
  fiches: Map<string, { nom: string }>,
): FicheDispo {
  return {
    id: vue.id,
    nom: vue.nom,
    nbPortions: vue.nbPortions,
    estSousRecette: vue.estSousRecette,
    rendementQuantite: vue.rendementQuantite || null,
    rendementUnite: vue.rendementUnite || null,
    ingredients: vue.lignes.map((l, i) => ({
      nom: nomLigne(l, i, articles, fiches),
      unite: l.unite,
      quantite: l.quantite,
      articleId: l.articleId,
      sousFicheId: l.sousFicheId,
    })),
  };
}

/**
 * Disponibilité de TOUTES les fiches, avec un seul contexte (fiches, articles, stock lus une fois).
 * `aujourdhui` (AAAA-MM-JJ, Kinshasa) : référence de la règle du stock figé.
 */
export function disponibilitesDesFiches(
  vues: FicheVue[],
  articles: ArticleDispo[],
  stocks: Record<string, StockArticle>,
  aujourdhui: string,
): Map<string, ResultatDisponibilite> {
  const mapArticles = new Map(articles.map((a) => [a.id, a]));
  const noms = new Map(vues.map((v) => [v.id, { nom: v.nom }]));
  const fiches = new Map(vues.map((v) => [v.id, versFicheDispo(v, mapArticles, noms)]));
  const contexte = { fiches, articles: mapArticles, stocks: new Map(Object.entries(stocks)) };
  return new Map(vues.map((v) => [v.id, calculerDisponibilite(fiches.get(v.id)!, contexte, aujourdhui)]));
}

/** Ce que la liste des fiches affiche de la disponibilité (sérialisable vers le client). */
export type DispoRow = {
  etat: EtatDispo;
  portions: number | null;
  limitant: string | null;
  enRupture: string[];
  raisons: string[];
  /** Sous-recette : son rendement lisible (« 1 000 g »), sinon null. */
  rendement: string | null;
  /** Fiche sans aucun ingrédient : « Recette à compléter » (ni disponible, ni à vérifier). */
  recetteACompleter?: boolean;
};

export function resumerDispo(r: ResultatDisponibilite, vue: Pick<FicheVue, "estSousRecette" | "rendementQuantite" | "rendementUnite">): DispoRow {
  const q = Number(vue.rendementQuantite);
  return {
    etat: r.etat,
    recetteACompleter: recetteACompleter(r),
    portions: r.portions,
    limitant: r.limitant,
    enRupture: r.enRupture,
    raisons: r.raisons.map(libelleRaison),
    rendement: vue.estSousRecette && vue.rendementQuantite && Number.isFinite(q)
      ? `${formaterNombre(q, { maximumFractionDigits: 3 })} ${vue.rendementUnite || "?"}`
      : null,
  };
}

/** Badge neutre d'une fiche sans recette. */
export const CLASSE_RECETTE_A_COMPLETER = "bg-muted text-muted-foreground";

export const DISPO_CLASSE: Record<EtatDispo, string> = {
  DISPONIBLE: "bg-emerald-100 text-emerald-800",
  RUPTURE: "bg-red-100 text-red-800",
  A_VERIFIER: "bg-amber-100 text-amber-800",
};

/**
 * Texte du badge de disponibilité. Un plat se lit en portions ; une sous-recette en rendements
 * (« 3 × 1 000 g »). `detail` est l'ingrédient limitant (infobulle, et texte visible sur téléphone).
 */
export function badgeDispo(d: DispoRow, estSousRecette: boolean): { texte: string; detail: string | null } {
  if (d.recetteACompleter) return { texte: "Recette à compléter", detail: null };
  if (d.etat === "A_VERIFIER") {
    const n = d.raisons.length;
    return { texte: `À vérifier · ${d.raisons[0] ?? "raison inconnue"}${n > 1 ? ` · ${n} raisons` : ""}`, detail: null };
  }
  if (d.etat === "RUPTURE") return { texte: `En rupture · ${d.enRupture.join(", ")}`, detail: null };
  const n = d.portions ?? 0;
  const quantite = estSousRecette
    ? d.rendement ? `${n} × ${d.rendement}` : `${n} fournée${n > 1 ? "s" : ""}`
    : `${n} portion${n > 1 ? "s" : ""}`;
  return { texte: `Disponible · ${quantite}`, detail: d.limitant ? `Limité par ${d.limitant}` : null };
}

/**
 * La fiche (sous-recettes comprises) utilise-t-elle un article au prix en FRANCS ? Son coût en
 * dollars est alors « ≈ » : converti au taux du jour (2026-10-08). Cycle de sous-recettes : arrêté.
 */
export function coutEnFrancsConvertis(id: string, vues: Map<string, FicheVue>, articles: Map<string, ArticleOption>, vus: Set<string> = new Set()): boolean {
  if (vus.has(id)) return false;
  vus.add(id);
  const v = vues.get(id);
  if (!v) return false;
  return v.lignes.some((l) => (l.articleId ? articles.get(l.articleId)?.prixApprox === true : l.sousFicheId ? coutEnFrancsConvertis(l.sousFicheId, vues, articles, vus) : false));
}
