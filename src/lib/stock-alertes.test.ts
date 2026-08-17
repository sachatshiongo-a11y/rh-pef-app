import { describe, expect, it } from "vitest";
import { niveauAlerte } from "./stock";
import { cleAlnum, jaccard, normTexte, sansAccents } from "./texte";

describe("niveauAlerte — règle validée sur le fichier d'inventaire", () => {
  it("sans seuil minimum (min ≤ 0) → jamais d'alerte, même à 0 (OK)", () => {
    expect(niveauAlerte(0, 0)).toBe("OK");
    expect(niveauAlerte(-1, 0)).toBe("OK");
    expect(niveauAlerte(50, 0)).toBe("OK");
  });
  it("seuil défini + stock ≤ 0 → URGENT", () => {
    expect(niveauAlerte(0, 24)).toBe("URGENT");
    expect(niveauAlerte(-1, 5)).toBe("URGENT");
  });
  it("0 < stock ≤ minimum → APPRO", () => {
    expect(niveauAlerte(2, 4)).toBe("APPRO");
    expect(niveauAlerte(4, 4)).toBe("APPRO");
  });
  it("stock > minimum → OK", () => {
    expect(niveauAlerte(5, 4)).toBe("OK");
    expect(niveauAlerte(3, 1)).toBe("OK");
    expect(niveauAlerte(1, 0)).toBe("OK");
  });
});

describe("texte — normalisation partagée des rapprochements", () => {
  it("sansAccents / normTexte", () => {
    expect(sansAccents("Crème Brûlée")).toBe("Creme Brulee");
    expect(normTexte("Crème BRÛLÉE")).toBe("creme brulee");
  });
  it("cleAlnum : clé stricte", () => {
    expect(cleAlnum("Elle & Vire — Cooking Cream 1L !")).toBe("ellevirecookingcream1l");
    expect(cleAlnum("S. pellegrino 50CL")).toBe("spellegrino50cl");
  });
  it("jaccard : similarité d'ensembles de mots", () => {
    expect(jaccard(["grana", "padano"], ["grana", "padano"])).toBe(1);
    expect(jaccard(["grana", "padano"], ["parmesan"])).toBe(0);
    expect(jaccard(["saumon", "frais"], ["saumon", "fume"])).toBeCloseTo(1 / 3, 5);
  });
});
