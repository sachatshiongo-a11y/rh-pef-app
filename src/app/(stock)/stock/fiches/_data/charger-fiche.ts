import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { StockArticle } from "@/lib/fiches/disponibilite";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { stockRestaurantPourDisponibilite } from "@/lib/stock-restaurant";
import { chargerEntreesStockResto, stocksComptesResto } from "@/lib/stock-restaurant-charger";
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
  photoUrl: true,
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
    photoUrl: f.photoUrl,
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

/**
 * Stock qui fait foi pour la disponibilité (décision Direction 2026-09-24) : le dépôt (`Stock`) ET
 * le restaurant. La part du restaurant est son STOCK THÉORIQUE (spec 2026-09-28) : dernier comptage
 * de chaque article du restaurant RATTACHÉ + livraisons « Livraison restaurant » reçues depuis, dans
 * l'unité de l'article — une livraison retire du dépôt ce qu'elle ajoute au restaurant, le total ne
 * bouge pas. Un article du restaurant inactif, non rattaché, sans comptage ni livraison n'apporte rien.
 * S'y ajoute la date du DERNIER mouvement de stock de chaque article (tous types, inventaire
 * compris) : UNE requête groupée `max(date)` par article — règle du stock figé.
 * Requêtes groupées pour TOUTES les fiches — jamais une requête par fiche ni par article.
 * `aujourdhui` (AAAA-MM-JJ, Kinshasa) : les livraisons datées après ne comptent pas encore.
 */
export async function chargerStocksDesFiches(aujourdhui: string = jourKinshasaISO()): Promise<Record<string, StockArticle>> {
  const [depots, entrees, mouvements, desactives] = await Promise.all([
    prisma.stock.findMany({ select: { articleId: true, quantite: true } }),
    chargerEntreesStockResto({ depuis: aujourdhui, jusquA: aujourdhui }),
    prisma.mouvementStock.groupBy({ by: ["articleId"], _max: { date: true } }),
    // Articles du restaurant DÉSACTIVÉS avec encore du stock compté : l'article du catalogue
    // rattaché passe « À vérifier » (jamais repli silencieux sur le dépôt seul).
    stocksComptesResto({ actif: false, articleStockId: { not: null } }),
  ]);
  // `MouvementStock.date` est une date PURE (@db.Date, minuit UTC) : AAAA-MM-JJ sans fuseau.
  const dernierMouvement = new Map(mouvements.map((m) => [m.articleId, m._max.date ? m._max.date.toISOString().slice(0, 10) : null]));
  const dm = (articleId: string) => dernierMouvement.get(articleId) ?? null;

  const stocks: Record<string, StockArticle> = {};
  for (const d of depots) stocks[d.articleId] = { depot: d.quantite.toString(), restaurant: null, dernierMouvement: dm(d.articleId) };
  for (const [articleId, restaurant] of stockRestaurantPourDisponibilite(entrees, aujourdhui)) {
    stocks[articleId] = { depot: stocks[articleId]?.depot ?? null, restaurant, dernierMouvement: dm(articleId) };
  }
  for (const d of desactives) {
    const articleId = d.articleStockId!;
    stocks[articleId] = { depot: stocks[articleId]?.depot ?? null, restaurant: { etat: "DESACTIVE_AVEC_STOCK", articleResto: d.designation, dateComptage: d.dateComptage }, dernierMouvement: dm(articleId) };
  }
  return stocks;
}
