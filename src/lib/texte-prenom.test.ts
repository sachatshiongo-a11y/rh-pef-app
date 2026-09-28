import { describe, it, expect } from "vitest";
import { prenomDe } from "./texte";

describe("prenomDe — la salutation de l'espace salarié", () => {
  it("format « Prénom Nom » : le premier mot", () => {
    expect(prenomDe("Aimée Mutita")).toBe("Aimée");
    expect(prenomDe("Esther Nsundi")).toBe("Esther");
    expect(prenomDe("  Rachel   Lunda ")).toBe("Rachel");
  });
  it("une précision entre parenthèses n'est pas le prénom", () => {
    expect(prenomDe("César (jardinier)")).toBe("César");
    expect(prenomDe("(jardinier) César")).toBe("César");
    expect(prenomDe("César(jardinier)")).toBe("César");
  });
  it("un nom d'un seul mot se garde tel quel", () => {
    expect(prenomDe("Gode")).toBe("Gode");
    expect(prenomDe("Rocy")).toBe("Rocy");
  });
  it("prénoms composés et ponctuation", () => {
    expect(prenomDe("Jean-Pierre Kabongo")).toBe("Jean-Pierre");
    expect(prenomDe("Gode,")).toBe("Gode");
  });
  it("rien d'utilisable → vide (salutation sans prénom)", () => {
    expect(prenomDe("")).toBe("");
    expect(prenomDe(null)).toBe("");
    expect(prenomDe("(stagiaire)")).toBe("");
  });
});
