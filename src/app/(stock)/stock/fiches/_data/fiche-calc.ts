// Passerelle entre les données d'écran et le moteur de coût pur (`src/lib/fiches/cout.ts`).
//
// Ce module ne calcule RIEN : il assemble les objets `FicheCalc`/`IngredientCalc` attendus par
// `calculerCout`, et met en forme ce que le moteur renvoie. Toute formule de coût, de marge ou de
// prix reste dans le moteur — un nom = une formule, écrite à un seul endroit.
//
// Les montants et quantités voyagent en TEXTE (et non en `number`) : c'est la seule forme à la fois
// sérialisable vers un composant client ET lisible par Decimal sans passer par le flottant.

import type { FicheCalc, IngredientCalc, MotifSansPrix } from "@/lib/fiches/cout";

/**
 * Article du catalogue, réduit à ce dont la fiche a besoin (prix en texte, pleine précision).
 * `uniteParCarton` n'y figure pas volontairement : le prix de vérité est le prix à l'unité, on ne
 * re-dérive jamais un prix depuis le carton (spec §12.5).
 */
export type ArticleOption = {
  id: string;
  designation: string;
  unite: string;
  prixUnitaireUSD: string | null;
  actif: boolean;
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
  lignes: LigneFiche[];
};

/** Libellé d'une ligne : le nom de l'article, celui de la sous-recette, ou un repère de rang. */
export function nomLigne(
  ligne: LigneFiche,
  index: number,
  articles: Map<string, ArticleOption>,
  fiches: Map<string, { nom: string }>,
): string {
  if (ligne.articleId) return articles.get(ligne.articleId)?.designation ?? "Article supprimé du catalogue";
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
      article: art ? { prixUnitaireUSD: art.prixUnitaireUSD, unite: art.unite } : null,
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
  QUANTITE_INVALIDE: "Quantité absente ou invalide",
  SANS_SOURCE: "Ni article du stock ni sous-recette",
  SOUS_FICHE_INTROUVABLE: "Sous-recette introuvable",
  RENDEMENT_ABSENT: "Sous-recette sans rendement renseigné",
  UNITE_RENDEMENT_INCOHERENTE: "Rendement de la sous-recette dans une autre unité que la consommation",
  COUT_INDETERMINE: "Sous-recette dont aucun ingrédient n'est valorisé",
  CYCLE: "Boucle : la recette se contient elle-même",
};

/** Ratio (0,875) → « 87,5 % ». Ce n'est PAS un montant : ni `usd()` ni `arrondirCentime` ici. */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/** Coefficient (8) → « × 8 ». Ce n'est pas un montant non plus. */
export function coef(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `× ${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}

export const TYPE_LABEL: Record<string, string> = { PLAT: "Plat", BAR: "Bar" };
