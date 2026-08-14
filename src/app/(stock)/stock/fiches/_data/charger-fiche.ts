import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ArticleOption, FicheVue } from "./fiche-calc";

// Lecture Prisma → vues d'écran. Les `Decimal` de la base sont convertis en TEXTE (jamais en
// `number`) : c'est ce qui permet de les passer tels quels à un composant client ET au moteur de
// coût, sans jamais repasser par un flottant.

const dec = (v: { toString(): string } | null | undefined): string => (v === null || v === undefined ? "" : v.toString());
const s = (v: string | null | undefined): string => v ?? "";

const SELECT_FICHE = {
  id: true,
  nom: true,
  categorie: true,
  type: true,
  nbPortions: true,
  tauxTVA: true,
  prixVenteTTC: true,
  coefficientMargeCible: true,
  estSousRecette: true,
  rendementQuantite: true,
  rendementUnite: true,
  recette: true,
  actif: true,
  ingredients: {
    orderBy: { ordre: "asc" },
    select: { id: true, articleId: true, sousFicheId: true, unite: true, quantite: true, ordre: true },
  },
} satisfies Prisma.FicheTechniqueSelect;

/**
 * Toutes les fiches, avec leurs lignes. Le moteur résout les sous-recettes par identifiant depuis
 * ce même jeu : une seule requête suffit, quelle que soit la profondeur d'imbrication.
 */
export async function chargerFichesVues(): Promise<FicheVue[]> {
  const fiches = await prisma.ficheTechnique.findMany({
    orderBy: [{ categorie: "asc" }, { nom: "asc" }],
    select: SELECT_FICHE,
  });

  return fiches.map((f) => ({
    id: f.id,
    nom: f.nom,
    categorie: s(f.categorie),
    type: f.type,
    nbPortions: f.nbPortions,
    tauxTVA: dec(f.tauxTVA),
    prixVenteTTC: dec(f.prixVenteTTC),
    coefficientMargeCible: dec(f.coefficientMargeCible),
    estSousRecette: f.estSousRecette,
    rendementQuantite: dec(f.rendementQuantite),
    rendementUnite: s(f.rendementUnite),
    recette: s(f.recette),
    actif: f.actif,
    lignes: f.ingredients.map((i) => ({
      id: i.id,
      articleId: i.articleId,
      sousFicheId: i.sousFicheId,
      unite: i.unite,
      quantite: dec(i.quantite),
      ordre: i.ordre,
    })),
  }));
}

const SELECT_ARTICLE = {
  id: true,
  designation: true,
  unite: true,
  prixUnitaireUSD: true,
  actif: true,
} satisfies Prisma.ArticleStockSelect;

type ArticleBrut = { id: string; designation: string; unite: string | null; prixUnitaireUSD: { toString(): string } | null; actif: boolean };

const versOption = (a: ArticleBrut): ArticleOption => ({
  id: a.id,
  designation: a.designation,
  unite: s(a.unite),
  prixUnitaireUSD: a.prixUnitaireUSD === null ? null : a.prixUnitaireUSD.toString(),
  actif: a.actif,
});

/**
 * Articles strictement nécessaires au calcul : ceux qu'au moins une fiche utilise. Un article
 * désactivé reste chargé — sans quoi son prix disparaîtrait et le coût changerait en silence.
 */
export async function chargerArticlesDesFiches(): Promise<ArticleOption[]> {
  const articles = await prisma.articleStock.findMany({
    where: { fichesIngredient: { some: {} } },
    select: SELECT_ARTICLE,
  });
  return articles.map(versOption);
}

/**
 * Articles proposables dans le sélecteur d'une fiche : les actifs, plus ceux déjà utilisés
 * (pour qu'une ligne existante n'affiche jamais un choix vide).
 */
export async function chargerArticlesSelectionnables(): Promise<ArticleOption[]> {
  const articles = await prisma.articleStock.findMany({
    where: { OR: [{ actif: true }, { fichesIngredient: { some: {} } }] },
    orderBy: { designation: "asc" },
    select: SELECT_ARTICLE,
  });
  return articles.map(versOption);
}
