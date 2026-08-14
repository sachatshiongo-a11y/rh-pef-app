import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import { facteur, poidsEmballage, normaliserUnite } from "@/lib/fiches/conversion";

describe("normaliserUnite", () => {
  it("Kg == kg (casse)", () => expect(normaliserUnite("Kg")).toBe("kg"));
  it("ignore les espaces superflus", () => expect(normaliserUnite("  L ")).toBe("l"));
});

describe("facteur — masse", () => {
  it("kg → g = 1000", () => expect(facteur("Kg", "g")!.toString()).toBe("1000"));
  it("g → kg = 0,001", () => expect(facteur("g", "kg")!.toString()).toBe("0.001"));
  it("kg → kg = 1", () => expect(facteur("kg", "kg")!.toString()).toBe("1"));
});

describe("facteur — volume", () => {
  it("volume L → cl = 100", () => expect(facteur("L", "cl")!.toString()).toBe("100"));
  it("L → ml = 1000", () => expect(facteur("L", "ml")!.toString()).toBe("1000"));
  it("cl → ml = 10", () => expect(facteur("cl", "ml")!.toString()).toBe("10"));
  it("ml → cl = 0,1", () => expect(facteur("ml", "cl")!.toString()).toBe("0.1"));
});

describe("facteur — comptage", () => {
  it("pièce → pièce = 1", () => expect(facteur("pièce", "pièce")!.toString()).toBe("1"));
  it("Pièce == pièce (casse, match exact) = 1", () =>
    expect(facteur("Pièce", "pièce")!.toString()).toBe("1"));
  it("bouteille → boîte incompatible = null", () => expect(facteur("bouteille", "boîte")).toBeNull());
});

describe("facteur — incompatibilités", () => {
  it("pièce → g incompatible = null", () => expect(facteur("Pièce", "g")).toBeNull());
  it("g → pièce incompatible = null", () => expect(facteur("g", "pièce")).toBeNull());
  it("masse → volume incompatible = null (kg → L)", () => expect(facteur("kg", "L")).toBeNull());
  it("volume → masse incompatible = null (L → kg)", () => expect(facteur("L", "kg")).toBeNull());
  it("unité inconnue = null", () => expect(facteur("truc", "g")).toBeNull());
});

describe("poidsEmballage", () => {
  it("unité-emballage 500 GR = 0,5 kg", () => expect(poidsEmballage("500 GR")!.toString()).toBe("0.5"));
  it("1 KG = 1", () => expect(poidsEmballage("1 KG")!.toString()).toBe("1"));
  it("minuscules et espace simple : 250 g = 0,25", () =>
    expect(poidsEmballage("250 g")!.toString()).toBe("0.25"));
  it("sans espace entre nombre et unité : 500GR = 0,5", () =>
    expect(poidsEmballage("500GR")!.toString()).toBe("0.5"));
  it("chaîne non reconnue = null", () => expect(poidsEmballage("pièce")).toBeNull());
  it("chaîne vide = null", () => expect(poidsEmballage("")).toBeNull());
});

describe("facteur — précision Decimal (pas de flottant)", () => {
  it("retourne bien une instance Decimal", () => {
    expect(facteur("kg", "g")).toBeInstanceOf(Decimal);
  });
});
