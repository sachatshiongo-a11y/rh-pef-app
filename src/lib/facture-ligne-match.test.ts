import { describe, it, expect } from "vitest";
import { rapprocherLignePdf } from "@/lib/facture-ligne-match";

const CAT = [
  { id: "a1", designation: "Lait de coco" },
  { id: "a2", designation: "Farine T55 25kg" },
  { id: "a3", designation: "Huile végétale 5L" },
];

describe("lecture PDF — rattachement d'une ligne à un article", () => {
  it("« Lait entier 1L » n'est PAS rattaché à « Lait de coco » : suggestion seulement, ligne à choisir", () => {
    const r = rapprocherLignePdf("Lait entier 1L", CAT);
    expect(r.article).toBeNull();
    expect(r.suggestion?.designation).toBe("Lait de coco"); // proposé, jamais appliqué
  });
  it("nom identique (casse, accents, espaces) : rattaché d'office", () => {
    expect(rapprocherLignePdf("  FARINE t55   25KG ", CAT).article?.id).toBe("a2");
    expect(rapprocherLignePdf("huile vegetale 5l", CAT).article?.id).toBe("a3");
  });
  it("deux articles de même nom : pas de rattachement sûr", () => {
    const r = rapprocherLignePdf("Sucre", [{ id: "s1", designation: "Sucre" }, { id: "s2", designation: "SUCRE" }]);
    expect(r.article).toBeNull();
  });
  it("rien de proche : ni article ni suggestion", () => {
    expect(rapprocherLignePdf("Détergent vaisselle", CAT)).toEqual({ article: null, suggestion: null });
  });
});
