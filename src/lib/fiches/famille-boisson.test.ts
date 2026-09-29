import { describe, it, expect } from "vitest";
import { familleBoisson, ongletFiche, lireOngletFiches } from "./famille-boisson";

describe("familleBoisson — la rubrique décide, jamais le nom", () => {
  it.each([
    ["Cocktail"],
    ["cocktails"],
    ["Cocktails"],
    ["Mocktail"],
    ["MOCKTAIL"],
    ["mocktails"],
    ["  Cocktail  "],
  ])("« %s » → Cocktails & mocktails", (rubrique) => {
    expect(familleBoisson(rubrique)).toBe("COCKTAIL");
  });

  it.each([
    ["Vin rouge"],
    ["Rhum"],
    ["Bière locale"],
    ["Jus de fruit"],
    ["Cocktail maison"], // rubrique inconnue : rangée en Boissons tant qu'elle n'est pas renommée
    ["Cocktails & mocktails"],
    ["s"],
  ])("« %s » → Boissons", (rubrique) => {
    expect(familleBoisson(rubrique)).toBe("BOISSON");
  });

  it("rubrique vide, absente ou blanche → Boissons", () => {
    expect(familleBoisson("")).toBe("BOISSON");
    expect(familleBoisson("   ")).toBe("BOISSON");
    expect(familleBoisson(null)).toBe("BOISSON");
    expect(familleBoisson(undefined)).toBe("BOISSON");
  });

  it("les accents sont ignorés", () => {
    expect(familleBoisson("Cócktail")).toBe("COCKTAIL");
  });
});

describe("ongletFiche — le type décide ; les sous-recettes restent avec les plats", () => {
  it("BAR → Boissons, PLAT → Plats", () => {
    expect(ongletFiche({ type: "BAR", estSousRecette: false })).toBe("boissons");
    expect(ongletFiche({ type: "PLAT", estSousRecette: false })).toBe("plats");
  });
  it("une sous-recette reste dans Plats, même de type BAR", () => {
    expect(ongletFiche({ type: "PLAT", estSousRecette: true })).toBe("plats");
    expect(ongletFiche({ type: "BAR", estSousRecette: true })).toBe("plats");
  });
});

describe("lireOngletFiches — l'onglet dans l'URL", () => {
  it("« boissons » est reconnu ; tout le reste retombe sur « plats »", () => {
    expect(lireOngletFiches("boissons")).toBe("boissons");
    expect(lireOngletFiches("plats")).toBe("plats");
    expect(lireOngletFiches(undefined)).toBe("plats");
    expect(lireOngletFiches("n'importe quoi")).toBe("plats");
  });
});
