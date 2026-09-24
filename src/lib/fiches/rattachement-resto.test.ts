import { describe, it, expect } from "vitest";
import { alerteUnite, cleDesignation, proposerRattachements } from "./rattachement-resto";
import { facteur } from "./conversion";

const cat = (id: string, designation: string, actif = true, unite: string | null = "kg") => ({ id, designation, actif, unite });
const resto = (id: string, designation: string, articleStockId: string | null = null, unite: string | null = "kg") => ({ id, designation, articleStockId, unite });
const kg = { uniteResto: "kg", uniteCatalogue: "kg", alerteUnite: null };

describe("proposerRattachements — jamais de rattachement deviné", () => {
  it("propose les noms identiques, sans tenir compte de la casse ni des espaces", () => {
    const p = proposerRattachements([resto("r1", "  Huile  de palme "), resto("r2", "BEURRE")], [cat("a1", "Huile de palme"), cat("a2", "Beurre")]);
    expect(p).toEqual([
      { articleRestoId: "r1", designationResto: "  Huile  de palme ", articleStockId: "a1", designationCatalogue: "Huile de palme", ...kg },
      { articleRestoId: "r2", designationResto: "BEURRE", articleStockId: "a2", designationCatalogue: "Beurre", ...kg },
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

describe("propositions — unités du restaurant et du catalogue", () => {
  it("chaque proposition porte les deux unités ; conversion possible (g → kg, emballage) : pas d'alerte", () => {
    const p = proposerRattachements(
      [resto("r1", "Farine", null, "g"), resto("r2", "Penne", null, "g")],
      [cat("a1", "Farine", true, "kg"), cat("a2", "Penne", true, "500 GR")],
    );
    expect(p.map((x) => [x.uniteResto, x.uniteCatalogue, x.alerteUnite])).toEqual([["g", "kg", null], ["g", "500 GR", null]]);
  });

  it("conversion impossible : « unités incompatibles » (masse contre volume, comptages différents)", () => {
    expect(alerteUnite("bouteille", "l")).toBe("UNITES_INCOMPATIBLES");
    expect(alerteUnite("kg", "l")).toBe("UNITES_INCOMPATIBLES");
    expect(alerteUnite("pièce", "paquet")).toBe("UNITES_INCOMPATIBLES");
    const [p] = proposerRattachements([resto("r1", "Vin", null, "bouteille")], [cat("a1", "Vin", true, "l")]);
    expect(p).toMatchObject({ uniteResto: "bouteille", uniteCatalogue: "l", alerteUnite: "UNITES_INCOMPATIBLES" });
  });

  it("l'une des deux unités vide (ou blanche) — ou les deux : « unité manquante », toujours proposée", () => {
    expect(alerteUnite(null, "kg")).toBe("UNITE_MANQUANTE");
    expect(alerteUnite("kg", "  ")).toBe("UNITE_MANQUANTE");
    expect(alerteUnite("", "")).toBe("UNITE_MANQUANTE");
    expect(alerteUnite(null, null)).toBe("UNITE_MANQUANTE");
    expect(proposerRattachements([resto("r1", "Sel", null, null)], [cat("a1", "Sel", true, null)])).toHaveLength(1);
  });
});

describe("facteur — deux unités VIDES ne sont pas identiques", () => {
  it("vide ↔ vide, blanc ↔ blanc, vide ↔ unité : null (« unité manquante »), jamais 1", () => {
    expect(facteur("", "")).toBeNull();
    expect(facteur("  ", " ")).toBeNull();
    expect(facteur("", "kg")).toBeNull();
    expect(facteur("kg", "")).toBeNull();
    expect(facteur("500 GR", "500 GR")!.toString()).toBe("1"); // l'identité d'une vraie unité reste 1
  });
});
