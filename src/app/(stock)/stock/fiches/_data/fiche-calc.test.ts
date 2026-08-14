import { describe, it, expect } from "vitest";
import { calculerCout } from "@/lib/fiches/cout";
import { construireContexte, versFicheCalc, type ArticleOption, type FicheVue } from "./fiche-calc";

// Ces tests verrouillent la PASSERELLE entre l'écran et le moteur : ce que l'écran envoie doit
// produire exactement les chiffres du moteur. Aucune formule n'est réimplémentée ici.

const art = (id: string, designation: string, unite: string, prix: string | null): ArticleOption => ({
  id, designation, unite, prixUnitaireUSD: prix, actif: true,
});

const fiche = (p: Partial<FicheVue> & { id: string; nom: string }): FicheVue => ({
  categorie: "", type: "PLAT", nbPortions: 1, tauxTVA: "0.16", prixVenteTTC: "",
  coefficientMargeCible: "", estSousRecette: false, rendementQuantite: "", rendementUnite: "",
  recette: "", actif: true, lignes: [], ...p,
});

describe("passerelle écran → moteur de coût", () => {
  it("valorise un article : 0,2 kg à 8,07 $/kg = 1,61 $", () => {
    const articles = new Map([["a1", art("a1", "Bœuf haché", "kg", "8.07")]]);
    const v = fiche({
      id: "f1", nom: "Test",
      lignes: [{ id: "l1", articleId: "a1", sousFicheId: null, unite: "kg", quantite: "0.2", ordre: 1 }],
    });
    const r = calculerCout(versFicheCalc(v, articles, new Map()));
    expect(r.coutTotal.toFixed(4)).toBe("1.6140");
    expect(r.incomplet).toBe(false);
  });

  it("passe les prix en TEXTE : aucune perte de précision par le flottant", () => {
    const articles = new Map([["a1", art("a1", "Épices", "kg", "7.387")]]);
    const v = fiche({
      id: "f1", nom: "Test",
      lignes: [{ id: "l1", articleId: "a1", sousFicheId: null, unite: "g", quantite: "3", ordre: 1 }],
    });
    const calc = versFicheCalc(v, articles, new Map());
    expect(calc.ingredients[0].article?.prixUnitaireUSD).toBe("7.387");
    expect(calc.ingredients[0].quantite).toBe("3");
  });

  it("un article sans prix est ANNONCÉ, jamais compté zéro, et nommé", () => {
    const articles = new Map([["a1", art("a1", "Basilic", "kg", null)]]);
    const v = fiche({
      id: "f1", nom: "Test",
      lignes: [{ id: "l1", articleId: "a1", sousFicheId: null, unite: "g", quantite: "10", ordre: 1 }],
    });
    const r = calculerCout(versFicheCalc(v, articles, new Map()));
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Basilic"]);
    expect(r.lignes[0].cout).toBeNull();
  });

  it("un article référencé mais absent du catalogue n'est pas valorisé à zéro", () => {
    const v = fiche({
      id: "f1", nom: "Test",
      lignes: [{ id: "l1", articleId: "disparu", sousFicheId: null, unite: "g", quantite: "10", ordre: 1 }],
    });
    const r = calculerCout(versFicheCalc(v, new Map(), new Map()));
    expect(r.incomplet).toBe(true);
    expect(r.lignes[0].motif).toBe("SANS_SOURCE");
  });

  it("le contexte résout une sous-recette par identifiant (56,8237 $ / 4600 g × 200 g)", () => {
    const articles = new Map([["a1", art("a1", "Bœuf haché", "kg", "56.8237")]]);
    const sauce = fiche({
      id: "s1", nom: "Sauce bolognaise", estSousRecette: true,
      rendementQuantite: "4600", rendementUnite: "g",
      lignes: [{ id: "ls", articleId: "a1", sousFicheId: null, unite: "kg", quantite: "1", ordre: 1 }],
    });
    const plat = fiche({
      id: "p1", nom: "Bolognaise",
      lignes: [{ id: "lp", articleId: null, sousFicheId: "s1", unite: "cl", quantite: "200", ordre: 1 }],
    });
    const ctx = construireContexte([sauce, plat], articles);
    const r = calculerCout(ctx.fiches.get("p1")!, ctx);
    expect(r.coutTotal.toFixed(4)).toBe("2.4706");
    expect(r.incomplet).toBe(false);
    expect(r.lignes[0].label).toBe("Sauce bolognaise");
  });

  it("une fiche qui se contient elle-même est détectée, sans boucle infinie", () => {
    const a = fiche({ id: "a", nom: "A", lignes: [{ id: "l1", articleId: null, sousFicheId: "b", unite: "g", quantite: "10", ordre: 1 }] });
    const b = fiche({ id: "b", nom: "B", rendementQuantite: "100", rendementUnite: "g", lignes: [{ id: "l2", articleId: null, sousFicheId: "a", unite: "g", quantite: "10", ordre: 1 }] });
    const ctx = construireContexte([a, b], new Map());
    const r = calculerCout(ctx.fiches.get("a")!, ctx);
    expect(r.cycle).toBe(true);
    expect(r.incomplet).toBe(true);
  });

  it("un champ d'entête vide devient null (et non 0) pour le moteur", () => {
    const v = fiche({ id: "f1", nom: "Test", prixVenteTTC: "", coefficientMargeCible: "", rendementQuantite: "" });
    const calc = versFicheCalc(v, new Map(), new Map());
    expect(calc.prixVenteTTC).toBeNull();
    expect(calc.coefficientMargeCible).toBeNull();
    expect(calc.rendementQuantite).toBeNull();
  });

  it("prix conseillé sur coût partiel : le drapeau minorant est levé", () => {
    const articles = new Map([["a1", art("a1", "Bœuf", "kg", null)], ["a2", art("a2", "Penne", "kg", "0.35")]]);
    const v = fiche({
      id: "f1", nom: "Test", coefficientMargeCible: "8",
      lignes: [
        { id: "l1", articleId: "a1", sousFicheId: null, unite: "kg", quantite: "1", ordre: 1 },
        { id: "l2", articleId: "a2", sousFicheId: null, unite: "kg", quantite: "0.2", ordre: 2 },
      ],
    });
    const r = calculerCout(versFicheCalc(v, articles, new Map()));
    expect(r.prixConseille).toEqual({ ht: 0.56, ttc: 0.65, minorant: true });
    expect(r.prixEstConseille).toBe(true);
  });
});
