import { describe, it, expect } from "vitest";
import { formaterUSD, formaterFC, formaterMontant, montantSigne, formaterNombre, normaliserEspaces } from "@/lib/montant";

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

describe("formaterNombre (nombres destinés aux PDF)", () => {
  // Le séparateur de milliers d'ICU (U+202F) n'a AUCUN glyphe dans Optima : react-pdf se rabat
  // alors sur Helvetica, qui dessine une barre en travers du chiffre suivant (bon de commande
  // 018/PEF/SO/AOÛT/26). Le formateur partagé doit donc ne rendre QUE des espaces ordinaires.
  const insecables = /[\u202F\u00A0\u2009]/;

  it("sépare les milliers par une espace ordinaire", () => {
    expect(formaterNombre(1049.76, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("1 049,76");
    expect(formaterNombre(1234567)).toBe("1 234 567");
  });

  it("n'émet aucune espace insécable", () => {
    expect(formaterNombre(1234567.891, { maximumFractionDigits: 3 })).not.toMatch(insecables);
    expect(formaterUSD(1049.76)).not.toMatch(insecables);
    expect(formaterFC(1250000)).not.toMatch(insecables);
  });

  it("garde le signe des nombres négatifs (contrairement à formaterUSD/FC)", () => {
    expect(formaterNombre(-12)).toBe("-12");
  });

  it("normaliserEspaces remplace fine insécable, insécable et fine", () => {
    expect(normaliserEspaces("1\u202F0 2\u00A00 3\u20090")).toBe("1 0 2 0 3 0");
  });
});
