import { describe, it, expect } from "vitest";
import { compteRecherche, filtrerRecherche } from "./recherche-stock";

describe("recherche Stock — accents ignorés, troncature dite", () => {
  const articles = [{ nom: "Crème fraîche" }, { nom: "Crème liquide" }, { nom: "Épices" }, { nom: "Sel" }];
  it("« creme » trouve « Crème », « epices » trouve « Épices », la casse n'y change rien", () => {
    expect(filtrerRecherche(articles, "creme", (a) => [a.nom]).total).toBe(2);
    expect(filtrerRecherche(articles, "EPICES", (a) => [a.nom]).premiers).toEqual([{ nom: "Épices" }]);
    expect(filtrerRecherche(articles, "crème", (a) => [a.nom]).total).toBe(2);
  });
  it("tous les mots doivent se retrouver (ordre libre)", () => {
    expect(filtrerRecherche(articles, "fraiche creme", (a) => [a.nom]).total).toBe(1);
  });
  it("limite les premiers mais compte TOUT : la troncature se dit", () => {
    const beaucoup = Array.from({ length: 30 }, (_, i) => ({ nom: `Lait ${i}` }));
    const r = filtrerRecherche(beaucoup, "lait", (a) => [a.nom]);
    expect(r.premiers).toHaveLength(12);
    expect(r.total).toBe(30);
    expect(compteRecherche(r.premiers.length, r.total)).toBe("12 premiers sur 30");
    expect(compteRecherche(3, 3)).toBe("3");
  });
  it("requête vide : rien", () => {
    expect(filtrerRecherche(articles, "   ", (a) => [a.nom]).total).toBe(0);
  });
});
