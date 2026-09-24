import { describe, it, expect } from "vitest";
import {
  calculerDisponibilite, convertirVersUniteArticle, decompterEtats, libelleRaison, stockRestaurantParArticle,
  type ArticleDispo, type ContexteDispo, type FicheDispo, type IngredientDispo, type StockArticle,
} from "./disponibilite";

// Disponibilité des plats : chaque cas de la spec §D, un par un. Les chiffres sont posés à la main ;
// aucun n'est recalculé par le code testé.

const art = (id: string, designation: string, unite: string): ArticleDispo => ({ id, designation, unite });
const ing = (nom: string, unite: string, quantite: string, source: { articleId?: string; sousFicheId?: string }): IngredientDispo => ({
  nom, unite, quantite, articleId: source.articleId ?? null, sousFicheId: source.sousFicheId ?? null,
});
const fiche = (p: Partial<FicheDispo> & { id: string; ingredients: IngredientDispo[] }): FicheDispo => ({
  nom: p.id, nbPortions: 1, estSousRecette: false, rendementQuantite: null, rendementUnite: null, ...p,
});
const depot = (q: string): StockArticle => ({ depot: q, restaurant: null });
const ctx = (p: { fiches?: FicheDispo[]; articles?: ArticleDispo[]; stocks?: Record<string, StockArticle> }): ContexteDispo => ({
  fiches: new Map((p.fiches ?? []).map((f) => [f.id, f])),
  articles: new Map((p.articles ?? []).map((a) => [a.id, a])),
  stocks: new Map(Object.entries(p.stocks ?? {})),
});

const FARINE = art("farine", "Farine", "kg");
const OEUF = art("oeuf", "Œuf", "pièce");
const CREME = art("creme", "Crème", "l");

describe("calculerDisponibilite — portions et ingrédient limitant", () => {
  it("l'ingrédient limitant est celui qui donne le moins de portions", () => {
    // 2 portions : 0,5 kg de farine et 4 œufs → 0,25 kg et 2 œufs par portion.
    const f = fiche({ id: "p", nbPortions: 2, ingredients: [ing("Farine", "kg", "0.5", { articleId: "farine" }), ing("Œuf", "pièce", "4", { articleId: "oeuf" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE, OEUF], stocks: { farine: depot("10"), oeuf: depot("9") } }));
    expect(r.etat).toBe("DISPONIBLE");
    expect(r.portions).toBe(4); // farine 40, œufs ⌊9 ÷ 2⌋ = 4
    expect(r.limitant).toBe("Œuf");
    expect(r.limitantId).toBe("oeuf");
    expect(r.articles.map((a) => a.portions)).toEqual([40, 4]);
    expect(r.articles[0]!.besoinParPortion).toBe("0.25");
  });

  it("égalité : le limitant est le premier dans l'ordre de la fiche", () => {
    const f = fiche({ id: "p", ingredients: [ing("Œuf", "pièce", "2", { articleId: "oeuf" }), ing("Farine", "kg", "1", { articleId: "farine" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE, OEUF], stocks: { farine: depot("5"), oeuf: depot("10") } }));
    expect(r.portions).toBe(5);
    expect(r.limitant).toBe("Œuf");
  });

  it("arrondi à l'entier inférieur, une seule fois, à la fin", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "0.3", { articleId: "farine" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE], stocks: { farine: depot("1") } }));
    expect(r.portions).toBe(3); // 3,33… → 3
  });

  it("convertit g → kg et ml → l", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "g", "250", { articleId: "farine" }), ing("Crème", "ml", "200", { articleId: "creme" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE, CREME], stocks: { farine: depot("2"), creme: depot("1") } }));
    expect(r.articles.map((a) => a.portions)).toEqual([8, 5]);
    expect(r.portions).toBe(5);
    expect(r.limitant).toBe("Crème");
  });

  it("une unité-emballage (« 500 GR ») se convertit comme pour le coût : par le poids du paquet", () => {
    const PATES = art("pates", "Penne", "500 GR");
    const f = fiche({ id: "p", ingredients: [ing("Penne", "g", "125", { articleId: "pates" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [PATES], stocks: { pates: depot("3") } }));
    expect(r.portions).toBe(12); // 3 paquets = 1 500 g ÷ 125 g
  });

  it("un besoin nul ou négatif est ignoré", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "0", { articleId: "farine" }), ing("Œuf", "pièce", "1", { articleId: "oeuf" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE, OEUF], stocks: { oeuf: depot("3") } }));
    expect(r.etat).toBe("DISPONIBLE"); // la farine sans stock ne compte pas : son besoin est nul
    expect(r.portions).toBe(3);
    expect(r.lignes[0]).toEqual({ articleIds: [], raisons: [], portions: null });
  });
});

describe("calculerDisponibilite — inconnus annoncés, jamais comptés zéro", () => {
  it("unité non convertible → À vérifier, ingrédient nommé", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "pièce", "1", { articleId: "farine" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE], stocks: { farine: depot("10") } }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.portions).toBeNull();
    expect(r.raisons).toEqual([{ motif: "UNITE_NON_CONVERTIBLE", ingredient: "Farine" }]);
    expect(libelleRaison(r.raisons[0]!)).toBe("Farine : unité non convertible");
  });

  it("pas de stock enregistré (ni dépôt ni restaurant) → À vérifier", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE] }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "PAS_DE_STOCK", ingredient: "Farine" }]);
    expect(r.articles[0]!.portions).toBeNull();
  });

  it("stock total négatif → À vérifier", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE], stocks: { farine: depot("-2") } }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "STOCK_NEGATIF", ingredient: "Farine" }]);
  });

  it("dépôt + restaurant sont additionnés", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" })] });
    const stocks = { farine: { depot: "2", restaurant: { etat: "OK" as const, quantite: "1.5", dateComptage: "2026-09-22" } } };
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE], stocks }));
    expect(r.portions).toBe(3);
    expect(r.articles[0]).toMatchObject({ depot: "2", restaurant: "1.5", disponible: "3.5", dateComptage: "2026-09-22" });
  });

  it("restaurant seul (aucune ligne Stock) : le comptage suffit", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" })] });
    const stocks = { farine: { depot: null, restaurant: { etat: "OK" as const, quantite: "2", dateComptage: "2026-09-22" } } };
    expect(calculerDisponibilite(f, ctx({ articles: [FARINE], stocks })).portions).toBe(2);
  });

  it("restaurant dans une unité non convertible → À vérifier (restaurant)", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" })] });
    const stocks = { farine: { depot: "5", restaurant: { etat: "UNITE_NON_CONVERTIBLE" as const, articleResto: "Farine (sac)" } } };
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE], stocks }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "UNITE_NON_CONVERTIBLE_RESTAURANT", ingredient: "Farine" }]);
  });

  it("RUPTURE contre À VÉRIFIER : l'inconnu l'emporte", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" }), ing("Œuf", "pièce", "1", { articleId: "oeuf" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE, OEUF], stocks: { farine: depot("0") } }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "PAS_DE_STOCK", ingredient: "Œuf" }]);
  });

  it("RUPTURE : les ingrédients à 0 portion sont nommés", () => {
    const f = fiche({ id: "p", ingredients: [ing("Farine", "kg", "1", { articleId: "farine" }), ing("Œuf", "pièce", "1", { articleId: "oeuf" })] });
    const r = calculerDisponibilite(f, ctx({ articles: [FARINE, OEUF], stocks: { farine: depot("0.5"), oeuf: depot("4") } }));
    expect(r.etat).toBe("RUPTURE");
    expect(r.portions).toBe(0);
    expect(r.enRupture).toEqual(["Farine"]);
  });

  it("une fiche sans ingrédient est À vérifier (« aucun ingrédient »)", () => {
    const r = calculerDisponibilite(fiche({ id: "p", ingredients: [] }), ctx({}));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "AUCUN_INGREDIENT", ingredient: null }]);
    expect(libelleRaison(r.raisons[0]!)).toBe("Aucun ingrédient");
  });

  it("des portions inexploitables rendent le plat À vérifier", () => {
    const f = fiche({ id: "p", nbPortions: 0, ingredients: [ing("Farine", "kg", "1", { articleId: "farine" })] });
    expect(calculerDisponibilite(f, ctx({ articles: [FARINE], stocks: { farine: depot("3") } })).raisons)
      .toEqual([{ motif: "PORTIONS_INVALIDES", ingredient: null }]);
  });
});

describe("calculerDisponibilite — sous-recettes", () => {
  // Sauce : 1 l de crème + 0,1 kg de farine → rendement 1 000 g. Le plat en prend 200 cl (= 200 g,
  // la règle du coût : le « cl » d'une sous-recette est un gramme).
  const sauce = fiche({
    id: "sauce", nom: "Sauce", estSousRecette: true, rendementQuantite: "1000", rendementUnite: "g",
    ingredients: [ing("Crème", "l", "1", { articleId: "creme" }), ing("Farine", "kg", "0.1", { articleId: "farine" })],
  });

  it("une sous-recette avec rendement est éclatée jusqu'aux articles de base", () => {
    const plat = fiche({ id: "plat", ingredients: [ing("Sauce", "cl", "200", { sousFicheId: "sauce" })] });
    const r = calculerDisponibilite(plat, ctx({ fiches: [sauce, plat], articles: [FARINE, CREME], stocks: { creme: depot("1"), farine: depot("1") } }));
    // Besoin par portion : 0,2 l de crème, 0,02 kg de farine → crème 5, farine 50.
    expect(r.articles.map((a) => [a.designation, a.besoinParPortion, a.portions])).toEqual([["Crème", "0.2", 5], ["Farine", "0.02", 50]]);
    expect(r.portions).toBe(5);
    expect(r.limitant).toBe("Crème");
    expect(r.lignes[0]).toEqual({ articleIds: ["creme", "farine"], raisons: [], portions: 5 });
  });

  it("division exacte : 200 g d'une sauce de 300 g (0,5 l de crème), 1 l en stock → 3 portions, pas 2", () => {
    const s = fiche({ id: "s", estSousRecette: true, rendementQuantite: "300", rendementUnite: "g", ingredients: [ing("Crème", "l", "0.5", { articleId: "creme" })] });
    const plat = fiche({ id: "plat", ingredients: [ing("Sauce", "g", "200", { sousFicheId: "s" })] });
    // Besoin exact : 0,5 × 200/300 = 1/3 l. Divisé en route, 200/300 s'arrondit à 0,666…67, le
    // besoin à 0,333…34, et 1 ÷ 0,333…34 donne 2,999… : une portion perdue sans raison.
    const r = calculerDisponibilite(plat, ctx({ fiches: [s, plat], articles: [CREME], stocks: { creme: depot("1") } }));
    expect(r.portions).toBe(3);
  });

  it("une sous-recette sans rendement → À vérifier", () => {
    const s = { ...sauce, rendementQuantite: null };
    const plat = fiche({ id: "plat", ingredients: [ing("Sauce", "g", "200", { sousFicheId: "sauce" })] });
    const r = calculerDisponibilite(plat, ctx({ fiches: [s, plat], articles: [FARINE, CREME], stocks: { creme: depot("5"), farine: depot("5") } }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "RENDEMENT_ABSENT", ingredient: "Sauce" }]);
  });

  it("une boucle est détectée, sans récursion infinie", () => {
    const a = fiche({ id: "a", nom: "A", estSousRecette: true, rendementQuantite: "100", rendementUnite: "g", ingredients: [ing("B", "g", "10", { sousFicheId: "b" })] });
    const b = fiche({ id: "b", nom: "B", estSousRecette: true, rendementQuantite: "100", rendementUnite: "g", ingredients: [ing("A", "g", "10", { sousFicheId: "a" })] });
    const r = calculerDisponibilite(a, ctx({ fiches: [a, b] }));
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "CYCLE", ingredient: "B › A" }]);
  });

  it("une sous-recette se compte en rendements (fournées entières), pas en portions", () => {
    const r = calculerDisponibilite({ ...sauce, nbPortions: 4 }, ctx({ fiches: [sauce], articles: [FARINE, CREME], stocks: { creme: depot("3"), farine: depot("1") } }));
    expect(r.portions).toBe(3); // crème 3 fournées, farine 10
  });

  it("le même article en direct et dans une sous-recette : les besoins s'additionnent", () => {
    const plat = fiche({ id: "plat", ingredients: [ing("Sauce", "g", "500", { sousFicheId: "sauce" }), ing("Farine", "g", "50", { articleId: "farine" })] });
    // Farine : 0,05 (sauce) + 0,05 (direct) = 0,1 kg par portion ; 1 kg → 10. Crème : 0,5 l → 4.
    const r = calculerDisponibilite(plat, ctx({ fiches: [sauce, plat], articles: [FARINE, CREME], stocks: { creme: depot("2"), farine: depot("1") } }));
    expect(r.articles.map((a) => [a.designation, a.portions])).toEqual([["Crème", 4], ["Farine", 10]]);
    expect(r.lignes.map((l) => l.portions)).toEqual([4, 10]);
  });
});

describe("stock du restaurant rattaché au catalogue", () => {
  const unites = new Map([["farine", "kg"], ["creme", "l"]]);

  it("convertit le comptage dans l'unité de l'article et additionne plusieurs articles rattachés", () => {
    const r = stockRestaurantParArticle([
      { articleStockId: "farine", designationResto: "Farine cuisine", uniteResto: "g", date: "2026-09-22", quantite: "1500" },
      { articleStockId: "farine", designationResto: "Farine pâtisserie", uniteResto: "kg", date: "2026-09-20", quantite: "2" },
    ], unites);
    expect(r.get("farine")).toEqual({ etat: "OK", quantite: "3.5", dateComptage: "2026-09-20" });
  });

  it("une unité non convertible marque l'article, sans rien additionner", () => {
    const r = stockRestaurantParArticle([
      { articleStockId: "creme", designationResto: "Crème (pot)", uniteResto: "pièce", date: "2026-09-22", quantite: "3" },
      { articleStockId: "creme", designationResto: "Crème (l)", uniteResto: "l", date: "2026-09-22", quantite: "1" },
    ], unites);
    expect(r.get("creme")).toEqual({ etat: "UNITE_NON_CONVERTIBLE", articleResto: "Crème (pot)" });
  });

  it("convertirVersUniteArticle : null quand l'unité est inconnue", () => {
    expect(convertirVersUniteArticle("250", "g", "kg")).toBe("0.25");
    expect(convertirVersUniteArticle("1", "bouteille", "l")).toBeNull();
  });
});

describe("decompterEtats", () => {
  it("compte les fiches par état", () => {
    expect(decompterEtats([{ etat: "RUPTURE" }, { etat: "A_VERIFIER" }, { etat: "RUPTURE" }])).toEqual({ DISPONIBLE: 0, RUPTURE: 2, A_VERIFIER: 1 });
  });
});
