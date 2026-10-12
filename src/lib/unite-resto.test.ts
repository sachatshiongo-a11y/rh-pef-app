import { describe, it, expect } from "vitest";
import { convertirQuantite, ecartUnite, libelleFacteur } from "@/lib/unite-resto";
import type { ArticleCatalogueLie } from "@/lib/stock-restaurant";

// Une seule unité par produit : celle de l'Inventaire. Le plan d'alignement est calculé, jamais appliqué ici.

const resto = (unite: string | null) => ({ id: "r", designation: "Beurre", espace: "CUISINE" as const, unite });
const art = (unite: string | null, extra: Partial<ArticleCatalogueLie> = {}): ArticleCatalogueLie => ({ id: `a-${unite}-${extra.contenance ?? ""}`, unite, designation: `Beurre ${unite ?? "?"}`, ...extra });

describe("écart d'unité avec l'Inventaire", () => {
  it("aucun rattachement, ou même unité (casse, pluriel, accents) : rien à aligner", () => {
    expect(ecartUnite(resto("kg"), [], true)).toBeNull();
    expect(ecartUnite(resto("kg"), [art("Kg"), art("kilos")], true)).toBeNull();
    expect(ecartUnite(resto("pièces"), [art("Piece")], true)).toBeNull();
  });

  it("kg au restaurant, g à l'Inventaire : alignable, facteur exact ×1 000 (fraction 1000/1)", () => {
    const e = ecartUnite(resto("kg"), [art("g")], true)!;
    expect(e).toMatchObject({ etat: "ALIGNABLE", facteurNum: "1000", facteurDen: "1", uniteResto: "kg", uniteInventaire: "g" });
    expect(libelleFacteur("1000", "1")).toBe("×1 000");
  });

  it("g au restaurant, kg à l'Inventaire : ÷1 000 ; cl au restaurant, bouteille de 75 cl : ÷75", () => {
    expect(ecartUnite(resto("g"), [art("kg")], true)).toMatchObject({ etat: "ALIGNABLE", facteurNum: "0.001", facteurDen: "1" });
    expect(libelleFacteur("0.001", "1")).toBe("÷1 000");
    const v = ecartUnite(resto("cl"), [art("Bouteille", { contenance: "75", contenanceUnite: "cl" })], true)!;
    expect(v).toMatchObject({ etat: "ALIGNABLE", facteurNum: "1", facteurDen: "75" });
  });

  it("non convertible : masse contre volume, contenance absente, unité de l'Inventaire manquante", () => {
    expect(ecartUnite(resto("kg"), [art("L")], true)).toMatchObject({ etat: "NON_CONVERTIBLE" });
    expect(ecartUnite(resto("cl"), [art("Bouteille")], true)).toMatchObject({ etat: "NON_CONVERTIBLE", raison: expect.stringContaining("aucun facteur entre cl et Bouteille") });
    expect(ecartUnite(resto("kg"), [art(null)], true)).toMatchObject({ etat: "NON_CONVERTIBLE", raison: expect.stringContaining("n'a pas d'unité dans l'Inventaire") });
  });

  it("plusieurs marques : d'unités différentes, ou de facteurs différents → non convertible (choix arbitraire refusé) ; mêmes facteurs → alignable", () => {
    expect(ecartUnite(resto("kg"), [art("g"), art("L")], true)).toMatchObject({ etat: "NON_CONVERTIBLE", raison: expect.stringContaining("unités différentes") });
    const b250 = art("Bouteille", { contenance: "250", contenanceUnite: "g" }), b500 = art("Bouteille", { contenance: "500", contenanceUnite: "g" });
    expect(ecartUnite(resto("g"), [b250, b500], true)).toMatchObject({ etat: "NON_CONVERTIBLE", raison: expect.stringContaining("facteurs différents") });
    expect(ecartUnite(resto("kg"), [art("g", { designation: "A" }), { ...art("g"), id: "autre" }], true)).toMatchObject({ etat: "ALIGNABLE" });
  });

  it("sans unité au restaurant : alignable s'il n'a aucun comptage, non convertible sinon (unité des comptages inconnue)", () => {
    expect(ecartUnite(resto(null), [art("kg")], false)).toMatchObject({ etat: "ALIGNABLE", facteurNum: "1", facteurDen: "1" });
    expect(ecartUnite(resto(null), [art("kg")], true)).toMatchObject({ etat: "NON_CONVERTIBLE" });
  });
});

describe("conversion exacte d'une quantité", () => {
  it("4,5 kg → 4 500 g exact ; 3 × (1/3) = 1 sans erreur de flottant", () => {
    expect(convertirQuantite("4.5", "1000", "1")).toEqual({ valeur: "4500", exact: true });
    expect(convertirQuantite("3", "1", "3")).toEqual({ valeur: "1", exact: true });
  });
  it("ne tient pas en 3 décimales : annoncé inexact (4,5 g → 0,0045 kg)", () => {
    expect(convertirQuantite("4.5", "1", "1000")).toEqual({ valeur: "0.0045", exact: false });
  });
});
