import { describe, it, expect } from "vitest";
import { consommationDesVentes, type ArticleVente } from "./ventes-consommation";
import {
  consommationReelle, ecartVentesConsommation, MOTIF_LIVRAISON_RESTAURANT, stockRestaurantPourDisponibilite, stockRestaurantTheorique,
  type EntreesStockResto,
} from "./stock-restaurant";
import { ecartsVentesConsommation, type PrixCatalogue } from "./ecarts-ventes";
import type { FicheDispo, IngredientDispo } from "./fiches/disponibilite";

// STOCK THÉORIQUE du restaurant = dernier comptage + livraisons − VENTES × FICHES (décision Direction du
// 2026-10-12). Comptage de FIN DE JOURNÉE : les ventes (comme les livraisons) du jour du comptage y sont déjà.

const LUNDI = "2026-10-05"; // comptage du lundi (fin de journée)
const art = (id: string, unite: string, extra: Partial<ArticleVente> = {}): ArticleVente => ({ id, designation: id.toUpperCase(), unite, domaine: "NOURRITURE", ...extra });
const ing = (nom: string, articleId: string | null, quantite: string, unite: string, sousFicheId: string | null = null): IngredientDispo => ({ nom, articleId, sousFicheId, quantite, unite });
const fiche = (id: string, ingredients: IngredientDispo[], extra: Partial<FicheDispo> = {}): FicheDispo => ({ id, nom: `Plat ${id}`, nbPortions: 1, estSousRecette: false, rendementQuantite: null, rendementUnite: null, ingredients, ...extra });

/** Entrées d'un article du restaurant « Farine » (kg) rattaché à l'article du catalogue `a1` (kg). */
function entrees(o: {
  fiches: FicheDispo[]; articles?: ArticleVente[]; ventes: { date: string; ficheId: string; quantite: number }[];
  comptages?: { date: string; quantite: string }[]; livraisons?: { id: string; date: string; quantite: string }[]; uniteResto?: string;
}): EntreesStockResto {
  const articles = o.articles ?? [art("a1", "kg")];
  const { conso, aVerifier } = consommationDesVentes(o.ventes, new Map(o.fiches.map((f) => [f.id, f])), new Map(articles.map((a) => [a.id, a])));
  return {
    articles: [{ id: "r1", designation: "Farine", espace: "CUISINE", unite: o.uniteResto ?? "kg", rattaches: articles.map((a) => ({ id: a.id, unite: a.unite, designation: a.designation, domaine: a.domaine, contenance: a.contenance === undefined ? null : String(a.contenance), contenanceUnite: a.contenanceUnite ?? null })) }],
    comptages: (o.comptages ?? [{ date: LUNDI, quantite: "2" }]).map((c) => ({ articleRestoId: "r1", ...c })),
    livraisons: (o.livraisons ?? [{ id: "l1", date: "2026-10-06", quantite: "3" }]).map((l) => ({ id: l.id, articleStockId: "a1", designation: "A1", uniteCatalogue: "kg", date: l.date, quantite: l.quantite, categorieSortie: MOTIF_LIVRAISON_RESTAURANT, domaine: "NOURRITURE" })),
    consoVentes: conso, ventesAVerifier: aVerifier,
  };
}
const stock = (e: EntreesStockResto, jour: string) => stockRestaurantTheorique(e, jour).parArticle.get("r1")!;

describe("stock théorique : comptage + livraisons − ventes × fiches", () => {
  const f = fiche("f1", [ing("Farine", "a1", "80", "g")]);

  it("cas chiffré : 2 kg comptés lundi + 3 kg livrés − 10 plats à 80 g vendus = 4,2 kg", () => {
    const e = entrees({ fiches: [f], ventes: [{ date: "2026-10-07", ficheId: "f1", quantite: 10 }] });
    const s = stock(e, "2026-10-08");
    expect(Number(s.stock)).toBeCloseTo(4.2, 9);
    expect(Number(s.vendu)).toBeCloseTo(0.8, 9);
    expect(s.ventesAVerifier).toEqual([]);
  });

  it("sans vente, le chiffre d'avant (comptage + livraisons) est inchangé", () => {
    const s = stock(entrees({ fiches: [f], ventes: [] }), "2026-10-08");
    expect(s.stock).toBe("5");
    expect(s.vendu).toBeNull();
  });

  it("jour du comptage : ses ventes sont DÉJÀ dans le comptage de fin de journée (jamais retirées deux fois) ; celles du lendemain le sont", () => {
    const e = entrees({ fiches: [f], ventes: [{ date: LUNDI, ficheId: "f1", quantite: 10 }, { date: "2026-10-06", ficheId: "f1", quantite: 5 }] });
    expect(Number(stock(e, "2026-10-06").vendu)).toBeCloseTo(0.4, 9); // seulement les 5 du mardi
    expect(Number(stock(e, "2026-10-06").stock)).toBeCloseTo(4.6, 9);
    // Avant tout lendemain : le jour du comptage, rien n'est retiré.
    expect(stock(e, LUNDI).vendu).toBeNull();
    expect(stock(e, LUNDI).stock).toBe("2");
  });

  it("ventes d'après le jour demandé ou antérieures au comptage : ignorées", () => {
    const e = entrees({ fiches: [f], ventes: [{ date: "2026-10-04", ficheId: "f1", quantite: 99 }, { date: "2026-10-09", ficheId: "f1", quantite: 10 }] });
    expect(stock(e, "2026-10-08").vendu).toBeNull();
    expect(Number(stock(e, "2026-10-09").vendu)).toBeCloseTo(0.8, 9);
  });

  it("une vente à 0 n'est ni un retrait ni un doute ; sans comptage, le stock n'est qu'une estimation de livraisons : aucune vente retirée", () => {
    expect(stock(entrees({ fiches: [f], ventes: [{ date: "2026-10-07", ficheId: "f1", quantite: 0 }] }), "2026-10-08").stock).toBe("5");
    const sansComptage = stock(entrees({ fiches: [f], comptages: [], ventes: [{ date: "2026-10-07", ficheId: "f1", quantite: 10 }] }), "2026-10-08");
    expect(sansComptage).toMatchObject({ stock: "3", aucunComptage: true, vendu: null });
  });

  it("un stock négatif reste un chiffre (signalé à l'écran), jamais rabattu à 0", () => {
    const e = entrees({ fiches: [f], ventes: [{ date: "2026-10-07", ficheId: "f1", quantite: 100 }] });
    expect(Number(stock(e, "2026-10-08").stock)).toBeCloseTo(-3, 9);
  });

  it("sous-recette développée : 100 g de sauce (1 000 g = 200 g de crème) par plat → 20 g de crème, 10 plats = 0,2 kg", () => {
    const sauce = fiche("s1", [ing("Crème", "a1", "200", "g")], { nom: "Sauce", estSousRecette: true, rendementQuantite: "1000", rendementUnite: "g" });
    const plat = fiche("f2", [ing("Sauce", null, "100", "g", "s1")]);
    const e = entrees({ fiches: [sauce, plat], ventes: [{ date: "2026-10-07", ficheId: "f2", quantite: 10 }] });
    expect(Number(stock(e, "2026-10-08").vendu)).toBeCloseTo(0.2, 9);
    expect(Number(stock(e, "2026-10-08").stock)).toBeCloseTo(4.8, 9);
  });

  it("plusieurs marques rattachées au même article du restaurant : la vente d'une fiche qui nomme l'une retire du stock commun", () => {
    const e = entrees({ fiches: [fiche("f3", [ing("Beurre", "a2", "50", "g")])], articles: [art("a1", "kg"), art("a2", "kg")], ventes: [{ date: "2026-10-07", ficheId: "f3", quantite: 20 }] });
    expect(Number(stock(e, "2026-10-08").stock)).toBeCloseTo(4, 9); // 5 − 20 × 50 g
  });

  it("unité du restaurant différente (g) : la consommation est convertie dans l'unité du restaurant", () => {
    const e = entrees({ fiches: [f], uniteResto: "g", comptages: [{ date: LUNDI, quantite: "2000" }], livraisons: [], ventes: [{ date: "2026-10-07", ficheId: "f1", quantite: 10 }] });
    expect(Number(stock(e, "2026-10-08").stock)).toBeCloseTo(1200, 6);
  });
});

describe("fiche incomplète ou inconvertible : « À vérifier », jamais un faux chiffre", () => {
  const vente = [{ date: "2026-10-07", ficheId: "f1", quantite: 10 }];

  it("quantité non renseignée sur une ligne : l'article de la fiche est « À vérifier » (raison nommée) et la disponibilité le dit", () => {
    const f = fiche("f1", [ing("Farine", "a1", "80", "g"), ing("Sel", "a1", "0", "g")]);
    const s = stock(entrees({ fiches: [f], ventes: vente }), "2026-10-08");
    expect(s.ventesAVerifier).toHaveLength(1);
    expect(s.ventesAVerifier[0]!.texte).toContain("Plat f1");
    expect(s.ventesAVerifier[0]!.texte).toContain("fiche incomplète");
    const dispo = stockRestaurantPourDisponibilite(entrees({ fiches: [f], ventes: vente }), "2026-10-08").get("a1");
    expect(dispo).toMatchObject({ etat: "VENTES_A_VERIFIER", articleResto: "Farine" });
  });

  it("unité d'ingrédient sans conversion possible (pièce → kg) : À vérifier sur CET article", () => {
    const f = fiche("f1", [ing("Farine", "a1", "2", "pièce")]);
    const e = entrees({ fiches: [f], ventes: vente });
    expect(stock(e, "2026-10-08").ventesAVerifier).not.toHaveLength(0);
    expect(stockRestaurantPourDisponibilite(e, "2026-10-08").get("a1")?.etat).toBe("VENTES_A_VERIFIER");
  });

  it("fiche sans ingrédient : aucune consommation connue, signalée en vente à vérifier (aucun article à marquer)", () => {
    const { aVerifier, conso } = consommationDesVentes(vente, new Map([["f1", fiche("f1", [])]]), new Map());
    expect(conso).toEqual([]);
    expect(aVerifier).toHaveLength(1);
    expect(aVerifier[0]!.raisons.join(" ")).toMatch(/aucun ingrédient/i);
  });

  it("sous-recette SANS rendement : les articles qu'elle engage (crème) sont « À vérifier », jamais un stock « OK » qui ignore la vente (relecture 2026-10-12)", () => {
    const sauce = fiche("s1", [ing("Crème", "a2", "200", "g")], { nom: "Sauce", estSousRecette: true, rendementQuantite: null });
    const seul = fiche("f1", [ing("Sauce", null, "100", "g", "s1")]);
    const mixte = fiche("f1", [ing("Farine", "a1", "80", "g"), ing("Sauce", null, "100", "g", "s1")]);
    const articles = [art("a1", "kg"), art("a2", "kg")];
    for (const f of [seul, mixte]) {
      const { aVerifier } = consommationDesVentes(vente, new Map([["f1", f], ["s1", sauce]]), new Map(articles.map((a) => [a.id, a])));
      expect(aVerifier[0]!.articles.map((a) => a.id)).toContain("a2");
    }
  });

  it("la vente d'une fiche incomplète AVANT le comptage ne dérange pas ; après, si", () => {
    const f = fiche("f1", [ing("Sel", "a1", "0", "g")]);
    expect(stock(entrees({ fiches: [f], ventes: [{ date: "2026-10-04", ficheId: "f1", quantite: 3 }] }), "2026-10-08").ventesAVerifier).toEqual([]);
    expect(stock(entrees({ fiches: [f], ventes: [{ date: "2026-10-09", ficheId: "f1", quantite: 3 }] }), "2026-10-08").ventesAVerifier).toEqual([]);
    expect(stock(entrees({ fiches: [f], ventes: [{ date: "2026-10-09", ficheId: "f1", quantite: 3 }] }), "2026-10-09").ventesAVerifier).toHaveLength(1);
  });

  it("disponibilité d'un article rattaché sain : retire les ventes (OK, avec le vendu)", () => {
    const e = entrees({ fiches: [fiche("f1", [ing("Farine", "a1", "80", "g")])], ventes: vente });
    const d = stockRestaurantPourDisponibilite(e, "2026-10-08").get("a1");
    expect(d?.etat).toBe("OK");
    if (d?.etat === "OK") { expect(Number(d.quantite)).toBeCloseTo(4.2, 9); expect(Number(d.vendu)).toBeCloseTo(0.8, 9); }
  });
});

describe("la consommation RÉELLE ne retire jamais les ventes", () => {
  it("avec ou sans ventes, la consommation réelle d'un jour compté est la même", () => {
    const comptages = [{ date: LUNDI, quantite: "2" }, { date: "2026-10-08", quantite: "3" }];
    const f = fiche("f1", [ing("Farine", "a1", "80", "g")]);
    const avec = consommationReelle(entrees({ fiches: [f], comptages, ventes: [{ date: "2026-10-07", ficheId: "f1", quantite: 10 }] }), "r1", "2026-10-08");
    const sans = consommationReelle(entrees({ fiches: [f], comptages, ventes: [] }), "r1", "2026-10-08");
    expect(avec).toEqual(sans);
    expect(avec).toMatchObject({ etat: "CONNUE", quantite: "2" }); // 2 + 3 livrés − 3 comptés
  });
});

describe("contrôle des écarts : réel (comptages + livraisons) vs théorique (ventes × fiches)", () => {
  // Gin : bouteille de 70 cl au catalogue ; cocktails à 4 cl ; prix 35 $ la bouteille.
  const gin = art("g1", "bouteille", { contenance: "70", contenanceUnite: "cl", domaine: "BOISSON", designation: "Gin" });
  const cocktail = fiche("c1", [ing("Gin", "g1", "4", "cl")], { nom: "Gin tonic" });
  const bar = (o: { ventes: number; comptes?: { date: string; quantite: string }[]; liv?: boolean }): EntreesStockResto => {
    const { conso, aVerifier } = consommationDesVentes(o.ventes ? [{ date: "2026-10-07", ficheId: "c1", quantite: o.ventes }] : [], new Map([["c1", cocktail]]), new Map([["g1", gin]]));
    return {
      articles: [{ id: "r2", designation: "Gin", espace: "BAR", unite: "bouteille", rattaches: [{ id: "g1", unite: "bouteille", designation: "Gin", domaine: "BOISSON", contenance: "70", contenanceUnite: "cl" }] }],
      comptages: (o.comptes ?? [{ date: "2026-10-04", quantite: "10" }, { date: "2026-10-11", quantite: "8" }]).map((c) => ({ articleRestoId: "r2", ...c })),
      livraisons: o.liv === false ? [] : [{ id: "l2", articleStockId: "g1", designation: "Gin", uniteCatalogue: "bouteille", date: "2026-10-07", quantite: "2", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, domaine: "BOISSON", contenanceCatalogue: "70", contenanceUniteCatalogue: "cl" }],
      consoVentes: conso, ventesAVerifier: aVerifier,
    };
  };
  const prix = new Map<string, PrixCatalogue>([["g1", { devise: "USD", montant: "35" }]]);

  it("bouteille de 70 cl, 60 cocktails à 4 cl : réel 4 bouteilles (10 + 2 − 8) face à 240 cl = 3,43 → écart 40 cl, 20 $", () => {
    const p = ecartVentesConsommation(bar({ ventes: 60 }), "r2", "2026-10-05", "2026-10-11");
    expect(p.etat).toBe("CONNUE");
    if (p.etat !== "CONNUE") return;
    expect(p).toMatchObject({ de: "2026-10-04", a: "2026-10-11", reelle: "4" });
    expect(Number(p.theorique)).toBeCloseTo(240 / 70, 9);
    expect(Number(p.ecart)).toBeCloseTo(4 - 240 / 70, 9);
    expect(p.parFiche).toHaveLength(1);
    const r = ecartsVentesConsommation(bar({ ventes: 60 }), "2026-10-05", "2026-10-11", prix);
    expect(r.BAR[0]!.valeur).toMatchObject({ devise: "USD", approx: false });
    expect(Number(r.BAR[0]!.valeur!.montant)).toBeCloseTo(20, 6);
    expect(Number(r.totaux.BAR.USD)).toBeCloseTo(20, 6);
    expect(r.CUISINE).toEqual([]); // bar et cuisine séparés
  });

  it("consommé en MOINS que les ventes ne l'expliquent : écart négatif", () => {
    const p = ecartVentesConsommation(bar({ ventes: 80 }), "r2", "2026-10-05", "2026-10-11");
    expect(p.etat === "CONNUE" && Number(p.ecart)).toBeLessThan(0);
  });

  it("pas de comptage utile → inconnu (« — »), jamais 0 ; un seul comptage : rien à comparer", () => {
    expect(ecartVentesConsommation(bar({ ventes: 60, comptes: [{ date: "2026-10-04", quantite: "10" }] }), "r2", "2026-10-05", "2026-10-11")).toMatchObject({ etat: "INCONNUE", raison: "PAS_DE_COMPTAGE" });
    expect(ecartVentesConsommation(bar({ ventes: 60, comptes: [{ date: "2026-10-09", quantite: "10" }] }), "r2", "2026-10-05", "2026-10-11")).toMatchObject({ etat: "INCONNUE", raison: "UN_SEUL_COMPTAGE" });
  });

  it("vente d'une fiche incomplète dans la fenêtre → inconnu (raison nommée), pas un faux écart", () => {
    const incomplet = fiche("c1", [ing("Gin", "g1", "0", "cl")], { nom: "Gin tonic" });
    const { conso, aVerifier } = consommationDesVentes([{ date: "2026-10-07", ficheId: "c1", quantite: 5 }], new Map([["c1", incomplet]]), new Map([["g1", gin]]));
    const e = { ...bar({ ventes: 0 }), consoVentes: conso, ventesAVerifier: aVerifier };
    const p = ecartVentesConsommation(e, "r2", "2026-10-05", "2026-10-11");
    expect(p).toMatchObject({ etat: "INCONNUE", raison: "VENTES_A_VERIFIER" });
  });

  it("tri par écart le plus fort ; les lignes sans valeur après, les inconnues en dernier ; prix en francs gardé en francs", () => {
    const e: EntreesStockResto = bar({ ventes: 60 });
    e.articles.push({ id: "r3", designation: "Rhum", espace: "BAR", unite: "bouteille", rattaches: [{ id: "g2", unite: "bouteille", designation: "Rhum", domaine: "BOISSON", contenance: "70", contenanceUnite: "cl" }] });
    const r = ecartsVentesConsommation(e, "2026-10-05", "2026-10-11", new Map([["g1", { devise: "CDF", montant: "98000" }]]), { tauxCDFParUSD: 2800 });
    expect(r.BAR.map((l) => l.designation)).toEqual(["Gin", "Rhum"]); // Rhum sans comptage → inconnu, en dernier
    expect(r.BAR[0]!.valeur).toMatchObject({ devise: "CDF" });
    expect(r.totaux.BAR.USD).toBeUndefined();
    expect(Number(r.totaux.BAR.CDF)).toBeCloseTo((4 - 240 / 70) * 98000, 3);
  });
});
