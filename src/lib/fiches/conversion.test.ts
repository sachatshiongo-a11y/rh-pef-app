import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import { facteur, poidsEmballage, normaliserUnite } from "@/lib/fiches/conversion";

describe("normaliserUnite", () => {
  it("Kg == kg (casse)", () => expect(normaliserUnite("Kg")).toBe("kg"));
  it("ignore les espaces superflus", () => expect(normaliserUnite("  L ")).toBe("l"));

  it("litre → l", () => expect(normaliserUnite("litre")).toBe("l"));
  it("Litres → l (casse + pluriel)", () => expect(normaliserUnite("Litres")).toBe("l"));
  it("gramme → g", () => expect(normaliserUnite("gramme")).toBe("g"));
  it("grammes → g", () => expect(normaliserUnite("grammes")).toBe("g"));
  it("gr → g", () => expect(normaliserUnite("gr")).toBe("g"));
  it("kilo → kg", () => expect(normaliserUnite("kilo")).toBe("kg"));
  it("kilos → kg", () => expect(normaliserUnite("kilos")).toBe("kg"));
  it("kilogramme → kg", () => expect(normaliserUnite("kilogramme")).toBe("kg"));
  it("kilogrammes → kg", () => expect(normaliserUnite("kilogrammes")).toBe("kg"));
  it("millilitre → ml", () => expect(normaliserUnite("millilitre")).toBe("ml"));
  it("millilitres → ml", () => expect(normaliserUnite("millilitres")).toBe("ml"));
  it("centilitre → cl", () => expect(normaliserUnite("centilitre")).toBe("cl"));
  it("centilitres → cl", () => expect(normaliserUnite("centilitres")).toBe("cl"));
  it("pièces → pièce", () => expect(normaliserUnite("pièces")).toBe("pièce"));
  it("unités → unité", () => expect(normaliserUnite("unités")).toBe("unité"));
  it("bouteilles → bouteille", () => expect(normaliserUnite("bouteilles")).toBe("bouteille"));
  it("boîtes → boîte", () => expect(normaliserUnite("boîtes")).toBe("boîte"));
  it("paquets → paquet", () => expect(normaliserUnite("paquets")).toBe("paquet"));
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

describe("facteur — variantes d'écriture (le cas de production : « Litre » vs « L »)", () => {
  it("Litre → l = 1 (même unité, deux orthographes)", () =>
    expect(facteur("Litre", "l")!.toString()).toBe("1"));
  it("litre → L = 1 (insensible à la casse et à l'orthographe)", () =>
    expect(facteur("litre", "L")!.toString()).toBe("1"));
  it("l → litre = 1", () => expect(facteur("l", "litre")!.toString()).toBe("1"));
  it("litre → cl = 100", () => expect(facteur("litre", "cl")!.toString()).toBe("100"));
  it("kilogramme → g = 1000", () => expect(facteur("kilogramme", "g")!.toString()).toBe("1000"));
  it("gramme → kilo = 0,001", () => expect(facteur("gramme", "kilo")!.toString()).toBe("0.001"));
  it("millilitres → cl = 0,1", () => expect(facteur("millilitres", "cl")!.toString()).toBe("0.1"));
});

describe("facteur — comptage", () => {
  it("pièce → pièce = 1", () => expect(facteur("pièce", "pièce")!.toString()).toBe("1"));
  it("Pièce == pièce (casse, match exact) = 1", () =>
    expect(facteur("Pièce", "pièce")!.toString()).toBe("1"));
  it("bouteille → boîte incompatible = null", () => expect(facteur("bouteille", "boîte")).toBeNull());
  it("pièces (pluriel) → pièce = 1", () => expect(facteur("pièces", "pièce")!.toString()).toBe("1"));
  it("bouteilles (pluriel) → bouteille = 1", () =>
    expect(facteur("bouteilles", "bouteille")!.toString()).toBe("1"));
});

describe("facteur — ligne rouge : jamais d'équivalence entre grandeurs différentes", () => {
  it("une unité de comptage élargie (pièces) ne se convertit toujours pas vers une masse (g) = null", () =>
    expect(facteur("pièces", "g")).toBeNull());
  it("une unité de comptage élargie (paquets) ne se convertit toujours pas vers une masse (kg) = null", () =>
    expect(facteur("paquets", "kg")).toBeNull());
  it("une unité de comptage (paquet) ne se convertit toujours pas vers un volume (l) = null", () =>
    expect(facteur("paquet", "l")).toBeNull());
  it("« 500 GR » (poids d'emballage, pas une unité) reste sans équivalence de comptage = null", () =>
    expect(facteur("500 gr", "paquet")).toBeNull());
  it("une unité totalement inconnue continue de renvoyer null (jamais un facteur deviné)", () =>
    expect(facteur("truc-inconnu", "g")).toBeNull());
  it("une orthographe non couverte par les alias reste inconnue = null (pas de devinette floue)", () =>
    expect(facteur("litreu", "l")).toBeNull());
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
