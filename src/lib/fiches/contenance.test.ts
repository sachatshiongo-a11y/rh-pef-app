import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { contenanceCanonique, contenanceDansNom, estUniteComptage, facteurVersArticle, lireContenanceSaisie } from "./conversion";
import { calculerCout } from "./cout";
import { calculerDisponibilite, convertirDepuisUniteArticle, convertirVersUniteArticle, type ContexteDispo } from "./disponibilite";

// Contenance d'un article compté à l'unité (import des fiches du bar, 2026-09-30) : une bouteille
// de 1 L à 14 $ consommée à 5 cl coûte 0,70 $ ; sans contenance, rien n'est supposé.

const fr = (f: { num: Decimal; den: Decimal } | null) => (f === null ? null : f.num.div(f.den).toString());

describe("contenance lue dans le nom d'un article", () => {
  // Noms RÉELS du catalogue de production (relevés le 2026-09-30).
  const cas: [string, string | null][] = [
    ["Absolut Vodka-75cl", "75 cl"], ["Bacardi blanc-1l", "1 l"], ["Bard Liq Triple Sec-70cl", "70 cl"], ["Cointreau-70cl", "70 cl"],
    ["Campari-1L", "1 l"], ["Aperol-1L", "1 l"], ["Hendrick S-700ml", "700 ml"], ["Monin Coconut Fruit-1L", "1 l"],
    ["Monin Blue Curacao Liqueur-70cl", "70 cl"], ["Monin- Curaçao Bleu-70cl", "70 cl"], ["Monin Mojito Mint Sirop-1L", "1 l"],
    ["Monin Frappe Base Vanilla Powder 2KG", "2 kg"], ["Monin Base Neutre Powder 2KG", "2 kg"], ["Sirop de Sucre de canne-CANADOU-70cl", "70 cl"],
    ["Scheweppes Soda-30cl", "30 cl"], ["Coca Cola-30cl", "30 cl"], ["Red bull-25cl", "25 cl"], ["Ceres Orange-1L", "1 l"],
    ["Ceres-Cranberry 1L", "1 l"], ["Ceres-Mangue 1L", "1 l"], ["Ceres Fruit de la passion-1L", "1 l"], ["Jus d'Ananas-Ceres-1L", "1 l"],
    ["Rhum Saint James Blc-70cl", "70 cl"], ["Camino Blanc-75cl", "75 cl"], ["Martini Rosso-75cl", "75 cl"],
    ["Piccini Prosecco Venetian Dress Extra Dry Blanc-75cl", "75 cl"], ["Monin-Sirop de Grenadine-1L", "1 l"],
    ["Sirop de Grenadine-70cl", "70 cl"], ["Monin-Sirop de pop corn-70cl", "70 cl"],
    // Sans contenance lisible : null, jamais une unité supposée.
    ["Beefeater Gin", null], ["Cassis", null], ["Triple sec", null], ["Crème de Coco", null],
    // Écritures du classeur.
    ["MONIN COCONUT FRUIT 1LTR", "1 l"], ["MONIN MOJITO MINT SIROP 1LT", "1 l"], ["VODKA ABSOLUT 750ML", "750 ml"], ["RED BULL 250 ML", "250 ml"],
    ["Jus d'Ananas-100", null], ["Sirop de Sucre de canne-70", null], ["20 PENNE RIGATE LM CHEF 12 X 1KG", "1 kg"], ["Pastis 51", null], ["V8cl", null],
    // Un nombre collé à un séparateur n'est pas une contenance : « .7L » n'est pas 7 l, « 1/2 L » pas 2 l.
    ["Vodka .7L", null], ["Vin 1/2 L", null], ["Vodka 0.7L", "0.7 l"], ["Vin 1,5L", "1.5 l"], ["Jus 33cl,1L", "33 cl"],
  ];
  it.each(cas)("« %s » → %s", (nom, attendu) => {
    const c = contenanceDansNom(nom);
    expect(c === null ? null : `${c.quantite.toString()} ${c.unite}`).toBe(attendu);
  });

  it("forme canonique : 1L = 1LTR = 100cl = 1000ML ; 70CL = 700ML ; 2KG = 2000 g", () => {
    const k = (n: string) => contenanceCanonique(contenanceDansNom(n));
    expect(new Set([k("x 1L"), k("x 1LTR"), k("x 1LT"), k("x 100cl"), k("x 1000ML")]).size).toBe(1);
    expect(k("x 70CL")).toBe(k("x 700ML"));
    expect(k("x 75CL")).toBe(k("x 750ml"));
    expect(k("x 2KG")).toBe("m:2000");
    expect(k("x 70cl")).not.toBe(k("x 75cl"));
    expect(k("x")).toBeNull();
  });
});

describe("facteurVersArticle — la porte unique vers l'unité de stock", () => {
  const bouteille = (contenance: string | null, contenanceUnite: string | null, unite = "Bouteille") => ({ unite, contenance, contenanceUnite });

  it("unités de comptage reconnues (pluriels, « (s) », accents)", () => {
    for (const u of ["Bouteille", "Bouteille(s)", "bouteilles", "Pièce", "piece", "Unité", "Boîte", "Paquet", "Canette"]) expect([u, estUniteComptage(u)]).toEqual([u, true]);
    for (const u of ["kg", "L", "cl", "Carton", "", null, "500 GR"]) expect([u, estUniteComptage(u)]).toEqual([u, false]);
  });

  it("bouteille de 1 L : 5 cl = 1/20 de bouteille ; 75 cl : 5 cl = 1/15 ; masse en g d'un pot de 2 kg", () => {
    expect(fr(facteurVersArticle("cl", bouteille("1", "l")))).toBe("0.01");
    expect(facteurVersArticle("cl", bouteille("75", "cl"))!.den.toString()).toBe("75");
    expect(new Decimal(5).times(facteurVersArticle("cl", bouteille("75", "cl"))!.num).div(75).toFixed(6)).toBe("0.066667");
    expect(fr(facteurVersArticle("g", bouteille("2", "kg")))).toBe("0.0005");
    expect(fr(facteurVersArticle("ml", bouteille("700", "ml", "Bouteille(s)")))).toBe(new Decimal(1).div(700).toString());
  });

  it("rien n'est supposé : sans contenance, grandeur différente, unité non comptée → null", () => {
    expect(facteurVersArticle("cl", bouteille(null, null))).toBeNull();
    expect(facteurVersArticle("cl", bouteille("0", "cl"))).toBeNull();
    expect(facteurVersArticle("g", bouteille("75", "cl"))).toBeNull(); // g d'un volume
    expect(facteurVersArticle("cl", bouteille("75", "cl", "Carton"))).toBeNull();
    expect(facteurVersArticle("cl", bouteille("1", "l", ""))).toBeNull(); // article sans unité
    expect(facteurVersArticle("unité", { unite: "Kg" })).toBeNull();
  });

  it("comportement historique inchangé : direct d'abord, puis emballage ; une bouteille reste une bouteille", () => {
    expect(fr(facteurVersArticle("g", { unite: "kg", contenance: "75", contenanceUnite: "cl" }))).toBe("0.001");
    expect(fr(facteurVersArticle("Bouteille", bouteille("75", "cl")))).toBe("1");
    expect(fr(facteurVersArticle("g", { unite: "500 GR" }))).toBe("0.002");
  });
});

describe("contenance dans le coût et la disponibilité", () => {
  const ligne = (unite: string, quantite: string, article: { prixUnitaireUSD: string; unite: string; contenance?: string | null; contenanceUnite?: string | null }) =>
    calculerCout({ id: "f", nbPortions: 1, tauxTVA: 0.16, estSousRecette: false, ingredients: [{ unite, quantite, article }] });

  it("bouteille de 1 L à 14 $ consommée à 5 cl = 0,70 $ ; sans contenance : « unité inconvertible », jamais 0", () => {
    expect(ligne("cl", "5", { prixUnitaireUSD: "14", unite: "Bouteille", contenance: "1", contenanceUnite: "l" }).coutTotal.toString()).toBe("0.7");
    expect(ligne("cl", "4", { prixUnitaireUSD: "9", unite: "Bouteille(s)", contenance: "75", contenanceUnite: "cl" }).coutTotal.toString()).toBe("0.48");
    const sans = ligne("cl", "5", { prixUnitaireUSD: "14", unite: "Bouteille" });
    expect(sans.lignes[0]).toMatchObject({ cout: null, motif: "UNITE_INCONVERTIBLE" });
    expect(sans.incomplet).toBe(true);
  });

  it("disponibilité : 2 bouteilles de 75 cl, 5 cl par verre → 30 verres ; conversions du restaurant par la même porte", () => {
    const c: ContexteDispo = {
      fiches: new Map(),
      articles: new Map([["abs", { id: "abs", designation: "Absolut Vodka-75cl", unite: "Bouteille", contenance: "75", contenanceUnite: "cl" }]]),
      stocks: new Map([["abs", { depot: "2", restaurant: null, dernierMouvement: "2026-09-29" }]]),
    };
    const r = calculerDisponibilite({ id: "v", nom: "Vodka", nbPortions: 1, estSousRecette: false, rendementQuantite: null, rendementUnite: null,
      ingredients: [{ nom: "Absolut", unite: "cl", quantite: "5", articleId: "abs", sousFicheId: null }] }, c, "2026-09-30");
    expect(r.portions).toBe(30);
    const abs = { unite: "Bouteille", contenance: "75", contenanceUnite: "cl" };
    expect(convertirVersUniteArticle("150", "cl", abs)).toBe("2");
    expect(convertirDepuisUniteArticle("2", abs, "cl")).toBe("150");
    expect(convertirVersUniteArticle("150", "cl", { unite: "Bouteille" })).toBeNull(); // unité seule : rien supposé
  });
});

describe("contenance saisie au catalogue", () => {
  it("les deux vides = aucune ; nombre (virgule admise) + unité ; sinon refus lisible", () => {
    expect(lireContenanceSaisie("", "")).toEqual({ contenance: null, contenanceUnite: null });
    expect(lireContenanceSaisie(null, null)).toEqual({ contenance: null, contenanceUnite: null });
    expect(lireContenanceSaisie("75", "cl")).toEqual({ contenance: "75", contenanceUnite: "cl" });
    expect(lireContenanceSaisie("0,75", "l")).toEqual({ contenance: "0.75", contenanceUnite: "l" });
    expect(() => lireContenanceSaisie("75", "")).toThrow(/nombre ET une unité/);
    expect(() => lireContenanceSaisie("", "cl")).toThrow(/nombre ET une unité/);
    expect(() => lireContenanceSaisie("75", "bouteille")).toThrow(/nombre ET une unité/);
    expect(() => lireContenanceSaisie("0", "cl")).toThrow(/supérieur à 0/);
    expect(() => lireContenanceSaisie("-5", "cl")).toThrow(/illisible/);
    expect(() => lireContenanceSaisie("abc", "cl")).toThrow(/illisible/);
    expect(() => lireContenanceSaisie("0.0005", "l")).toThrow(/3 décimales/);
    // Notations que Decimal accepterait : refusées, jamais interprétées.
    for (const n of ["1e5", "0x10", "Infinity", "7.", ".7", "1 000", "+5"]) expect(() => lireContenanceSaisie(n, "cl")).toThrow(/illisible/);
  });
});
