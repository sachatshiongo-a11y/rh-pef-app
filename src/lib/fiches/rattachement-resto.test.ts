import { describe, it, expect } from "vitest";
import { cleDesignation, proposerRattachements } from "./rattachement-resto";

const cat = (id: string, designation: string, actif = true) => ({ id, designation, actif });
const resto = (id: string, designation: string, articleStockId: string | null = null) => ({ id, designation, articleStockId });

describe("proposerRattachements — jamais de rattachement deviné", () => {
  it("propose les noms identiques, sans tenir compte de la casse ni des espaces", () => {
    const p = proposerRattachements([resto("r1", "  Huile  de palme "), resto("r2", "BEURRE")], [cat("a1", "Huile de palme"), cat("a2", "Beurre")]);
    expect(p).toEqual([
      { articleRestoId: "r1", designationResto: "  Huile  de palme ", articleStockId: "a1", designationCatalogue: "Huile de palme" },
      { articleRestoId: "r2", designationResto: "BEURRE", articleStockId: "a2", designationCatalogue: "Beurre" },
    ]);
  });

  it("ne propose rien pour un nom seulement proche (accent, pluriel, mot en plus)", () => {
    expect(proposerRattachements([resto("r1", "Creme"), resto("r2", "Tomates"), resto("r3", "Tomate cerise")], [cat("a1", "Crème"), cat("a2", "Tomate")])).toEqual([]);
  });

  it("ignore un article du restaurant déjà rattaché", () => {
    expect(proposerRattachements([resto("r1", "Beurre", "a9")], [cat("a2", "Beurre")])).toEqual([]);
  });

  it("ignore un article du catalogue inactif, et refuse l'ambiguïté (deux candidats)", () => {
    expect(proposerRattachements([resto("r1", "Beurre")], [cat("a2", "Beurre", false)])).toEqual([]);
    expect(proposerRattachements([resto("r1", "Sel")], [cat("a1", "Sel"), cat("a2", "SEL")])).toEqual([]);
  });

  it("cleDesignation retire tous les espaces et la casse, garde les accents", () => {
    expect(cleDesignation(" Crème  Fraîche ")).toBe("crèmefraîche");
    expect(cleDesignation("Creme")).not.toBe(cleDesignation("Crème"));
  });
});
