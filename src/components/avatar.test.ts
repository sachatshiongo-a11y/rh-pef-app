import { describe, it, expect } from "vitest";
import { initiales } from "./avatar";

describe("initiales de l'avatar", () => {
  it("Prénom Nom → deux lettres ; un seul mot → une lettre", () => {
    expect(initiales("Aimée Mutita")).toBe("AM");
    expect(initiales("Gode")).toBe("G");
  });
  it("une précision entre parenthèses est ignorée", () => {
    expect(initiales("César (jardinier)")).toBe("C");
    expect(initiales("Rachel Lunda (plonge)")).toBe("RL");
  });
  it("rien d'utilisable → vide", () => {
    expect(initiales("")).toBe("");
    expect(initiales("(stagiaire)")).toBe("");
  });
});
