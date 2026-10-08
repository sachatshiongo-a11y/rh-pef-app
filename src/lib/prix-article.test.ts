import { describe, it, expect } from "vitest";
import { formaterPrix, libellePrixComplet, libellesPrix, prixArticleEnCDF, prixArticleEnUSD, prixArticleEnUSDTexte, prixProposeEn, prixReferenceNouvelArticle, prixSaisi, valeurEnUSD } from "./prix-article";

const usdA = { devisePrix: "USD" as const, prixUnitaireUSD: "2.5", prixUnitaireCDF: null };
const fcA = { devisePrix: "CDF" as const, prixUnitaireUSD: null, prixUnitaireCDF: "7000" };

describe("prix de référence d'un article : la devise de saisie fait foi", () => {
  it("un article en USD garde son prix EXACT (aucun chiffre existant ne change)", () => {
    expect(prixSaisi(usdA)).toEqual({ devise: "USD", montant: "2.5" });
    expect(prixArticleEnUSD(usdA, 2800)).toEqual({ valeur: 2.5, approx: false });
    expect(prixArticleEnUSD(usdA, null)).toEqual({ valeur: 2.5, approx: false }); // pas besoin du taux
    expect(prixArticleEnUSDTexte({ prixUnitaireUSD: "7.3870" }, 2800)).toEqual({ valeur: "7.3870", approx: false }); // ancienne lecture sans devise
    expect(valeurEnUSD(usdA, 4, 2800)).toEqual({ valeur: 10, approx: false });
  });

  it("un article en FC vaut ses francs ; l'équivalent en dollars est « ≈ » au taux du jour", () => {
    expect(prixSaisi(fcA)).toEqual({ devise: "CDF", montant: "7000" });
    expect(prixArticleEnCDF(fcA, 2800)).toEqual({ valeur: 7000, approx: false });
    expect(prixArticleEnUSD(fcA, 2800)).toEqual({ valeur: 2.5, approx: true });
    // Le taux change : le franc ne bouge pas, seul le dollar bouge (aucun aller-retour).
    expect(prixArticleEnCDF(fcA, 3500)).toEqual({ valeur: 7000, approx: false });
    expect(prixArticleEnUSD(fcA, 3500)).toEqual({ valeur: 2, approx: true });
    expect(valeurEnUSD(fcA, 10, 2800)).toEqual({ valeur: 25, approx: true });
  });

  it("taux absent ou nul : « — » (null), jamais 0", () => {
    expect(prixArticleEnUSD(fcA, null)).toBeNull();
    expect(prixArticleEnUSD(fcA, 0)).toBeNull();
    expect(valeurEnUSD(fcA, 3, 0)).toBeNull();
    expect(prixArticleEnCDF(usdA, 0)).toBeNull();
    expect(libellesPrix(fcA, 0)).toEqual({ principal: "7 000 FC", autre: "≈ —", devise: "CDF" });
  });

  it("pas de prix : « — »", () => {
    expect(prixSaisi({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: null })).toBeNull();
    expect(libellesPrix({ prixUnitaireUSD: null }, 2800)).toEqual({ principal: "—", autre: null, devise: null });
    expect(valeurEnUSD({ prixUnitaireUSD: null }, 2, 2800)).toBeNull();
  });

  it("libellés : la devise de saisie d'abord, l'autre « ≈ » à côté", () => {
    expect(libellesPrix(fcA, 2800)).toEqual({ principal: "7 000 FC", autre: "≈ 2,50 $", devise: "CDF" });
    expect(libellesPrix(usdA, 2800)).toEqual({ principal: "2,50 $", autre: "≈ 7 000 FC", devise: "USD" });
    expect(libellePrixComplet(fcA, 2800)).toBe("7 000 FC (≈ 2,50 $)");
    expect(formaterPrix(0.17857, "USD")).toBe("0,1786 $");
    expect(formaterPrix(12, "USD")).toBe("12,00 $");
  });

  it("prix proposé à la saisie dans la devise d'une ligne : exact, ou converti arrondi (franc / 4 décimales)", () => {
    expect(prixProposeEn(fcA, "CDF", 2800)).toBe(7000);
    expect(prixProposeEn(fcA, "USD", 2850)).toBe(2.4561);
    expect(prixProposeEn(usdA, "CDF", 2850)).toBe(7125);
    expect(prixProposeEn(usdA, "USD", null)).toBe(2.5);
    expect(prixProposeEn(fcA, "USD", null)).toBeNull();
  });
});

describe("prixReferenceNouvelArticle — article créé par la Liste d'achat (décision 2026-10-08)", () => {
  it("ligne en francs → article en francs : PU = montant ÷ quantité, au centime ; aucun dollar stocké", () => {
    expect(prixReferenceNouvelArticle("CDF", 11200, 4)).toEqual({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: 2800 });
    expect(prixReferenceNouvelArticle("CDF", 10000, 3)).toEqual({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: 3333.33 });
  });
  it("ligne en dollars → article en dollars, règle d'avant (4 décimales)", () => {
    expect(prixReferenceNouvelArticle("USD", 9, 2)).toEqual({ devisePrix: "USD", prixUnitaireUSD: 4.5, prixUnitaireCDF: null });
    expect(prixReferenceNouvelArticle("USD", 5, 28)).toEqual({ devisePrix: "USD", prixUnitaireUSD: 0.1786, prixUnitaireCDF: null });
  });
  it("sans montant (vide, 0) : prix NULL dans la devise de la ligne — jamais 0", () => {
    expect(prixReferenceNouvelArticle("CDF", null, 2)).toEqual({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: null });
    expect(prixReferenceNouvelArticle("CDF", 0, 2)).toEqual({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: null });
    expect(prixReferenceNouvelArticle("USD", null, 2)).toEqual({ devisePrix: "USD", prixUnitaireUSD: null, prixUnitaireCDF: null });
  });
  it("prix si petit qu'il s'arrondirait à 0 (100 FC pour 25 000 g) : NULL, jamais 0", () => {
    expect(prixReferenceNouvelArticle("CDF", 100, 25000)).toEqual({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: null });
    expect(prixReferenceNouvelArticle("USD", 1, 100000)).toEqual({ devisePrix: "USD", prixUnitaireUSD: null, prixUnitaireCDF: null });
    expect(prixReferenceNouvelArticle("CDF", 100, 20000)).toEqual({ devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: 0.01 }); // 0,005 → 0,01
  });
});
