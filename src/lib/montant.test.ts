import { describe, it, expect } from "vitest";
import { formaterUSD, formaterFC, formaterMontant, montantSigne } from "@/lib/montant";

describe("montant", () => {
  it("USD fr-FR 2 déc.", () => expect(formaterUSD(1234.5)).toBe("1 234,50 $"));
  it("FC entier + sigle", () => expect(formaterFC(2500)).toBe("2 500 FC"));
  it("négatif = parenthèses + drapeau rouge", () => {
    const m = montantSigne(-1200, "USD");
    expect(m.negatif).toBe(true);
    expect(m.texte).toBe("(1 200,00 $)");
  });
  it("positif = pas de parenthèses", () => expect(montantSigne(50, "USD").negatif).toBe(false));

  it("formaterMontant délègue selon la devise", () => {
    expect(formaterMontant(10, "USD")).toBe("10,00 $");
    expect(formaterMontant(10, "CDF")).toBe("10 FC");
  });

  it("FC négatif = parenthèses + drapeau rouge (pas de signe -)", () => {
    const m = montantSigne(-5000, "CDF");
    expect(m.negatif).toBe(true);
    expect(m.texte).toBe("(5 000 FC)");
  });

  it("zéro n'est pas négatif", () => expect(montantSigne(0, "USD").negatif).toBe(false));
});
