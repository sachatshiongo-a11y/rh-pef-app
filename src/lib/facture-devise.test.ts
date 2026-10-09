import { describe, it, expect } from "vitest";
import {
  additionnerTotaux, ajouterAuTotal, equivalentUSD, formaterMontantFacture, libelleAutreDevise, libelleEquivalent, libelleTotal,
  montantsFacture, totalDepuisSommes, totalFactures, totalVide,
} from "./facture-devise";
import { dollarsEnFrancs, dollarsPourReste, francsEnDollars, imputation } from "./validations-stock/conversion-francs";

// Factures fournisseurs en francs (2026-10-09) : la devise de saisie fait foi ; une facture en
// dollars se lit EXACTEMENT comme avant ; les totaux ne mélangent jamais les devises.

const enDollars = { montantUSD: "120.50", montantRegleUSD: "20.50", resteAPayerUSD: "100.00", montantCDF: null, montantRegleCDF: null, resteAPayerCDF: null };
const enFrancs = { devise: "CDF" as const, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null, montantCDF: "2800000", montantRegleCDF: "0", resteAPayerCDF: "2800000" };

describe("montants d'une facture dans sa devise", () => {
  it("une facture d'avant (sans devise) se lit en dollars, à l'identique", () => {
    expect(montantsFacture(enDollars)).toEqual({ devise: "USD", montant: 120.5, regle: 20.5, reste: 100, resteTexte: "100" });
  });
  it("une facture en francs se lit en francs, jamais convertie", () => {
    expect(montantsFacture(enFrancs)).toEqual({ devise: "CDF", montant: 2800000, regle: 0, reste: 2800000, resteTexte: "2800000" });
  });
  it("formatage : dollars au centime, francs sans décimale (centimes montrés s'il y en a)", () => {
    expect(formaterMontantFacture(1234.5, "USD")).toBe("1 234,50 $");
    expect(formaterMontantFacture(2800000, "CDF")).toBe("2 800 000 FC");
    expect(formaterMontantFacture(17502.5, "CDF")).toBe("17 502,50 FC");
  });
});

describe("totaux par devise", () => {
  it("dollars seuls : le libellé d'avant ; rien : « 0,00 $ » (ou le vide demandé)", () => {
    expect(libelleTotal(totalFactures([enDollars, enDollars], "reste"))).toBe("200,00 $");
    expect(libelleTotal(totalVide())).toBe("0,00 $");
    expect(libelleTotal(totalVide(), "—")).toBe("—");
  });
  it("deux devises : « 1 234,50 $ + 2 800 000 FC », jamais additionnées", () => {
    const t = ajouterAuTotal(ajouterAuTotal(totalVide(), "USD", 1234.5), "CDF", 2800000);
    expect(libelleTotal(t)).toBe("1 234,50 $ + 2 800 000 FC");
    expect(t).toEqual({ usd: 1234.5, cdf: 2800000, nbUSD: 1, nbCDF: 1 });
  });
  it("francs seuls : pas de « 0,00 $ + »", () => {
    expect(libelleTotal(totalFactures([enFrancs], "montant"))).toBe("2 800 000 FC");
  });
  it("équivalent unique : exact sans francs, « ≈ » au taux du jour avec, null sans taux (jamais 0)", () => {
    const t = additionnerTotaux(totalFactures([enDollars], "reste"), totalFactures([enFrancs], "reste"));
    expect(equivalentUSD(totalFactures([enDollars], "reste"), null)).toEqual({ valeur: 100, approx: false });
    expect(equivalentUSD(t, 2800)).toEqual({ valeur: 1100, approx: true });
    expect(equivalentUSD(t, null)).toBeNull();
    expect(equivalentUSD(t, 0)).toBeNull();
    expect(libelleEquivalent(t, 2800)).toBe("≈ 1 100,00 $ au taux du jour");
    expect(libelleEquivalent(totalFactures([enDollars], "reste"), 2800)).toBeNull();
  });
  it("agrégat Prisma : chaque colonne est le total de sa devise (NULL = rien)", () => {
    expect(totalDepuisSommes("1234.5", null, { usd: 3 })).toEqual({ usd: 1234.5, cdf: 0, nbUSD: 3, nbCDF: 0 });
  });
  it("autre devise au taux du jour, « ≈ — » sans taux", () => {
    expect(libelleAutreDevise(280000, "CDF", 2800)).toBe("≈ 100,00 $");
    expect(libelleAutreDevise(100, "USD", 2800)).toBe("≈ 280 000 FC");
    expect(libelleAutreDevise(100, "USD", null)).toBe("≈ —");
  });
});

describe("imputation d'un versement (LA règle des règlements)", () => {
  it("facture en dollars payée en francs : la règle du 2026-10-08, inchangée", () => {
    expect(imputation("USD", { devise: "CDF", montant: 280000 }, 2800, 100)).toEqual({ impute: francsEnDollars(280000, 2800), depasse: false, converti: true });
    expect(imputation("USD", { devise: "CDF", montant: 300000 }, 2800, 100)?.depasse).toBe(true);
    expect(imputation("USD", { devise: "USD", montant: 100 }, null, 100)).toEqual({ impute: 100, depasse: false, converti: false });
  });
  it("facture en francs payée en francs : aucune conversion, aucun taux requis", () => {
    expect(imputation("CDF", { devise: "CDF", montant: 100000 }, null, 280000)).toEqual({ impute: 100000, depasse: false, converti: false });
    expect(imputation("CDF", { devise: "CDF", montant: 280001 }, null, 280000)?.depasse).toBe(true);
  });
  it("facture en francs payée en dollars : dollars × taux du jour ; à un demi-centime près, le reste est soldé", () => {
    expect(dollarsEnFrancs(10, 2800)).toBe(28000);
    expect(imputation("CDF", { devise: "USD", montant: 10 }, 2800, 100000)).toEqual({ impute: 28000, depasse: false, converti: true });
    // 100 000 FC à 2 800 : 35,71 $ proposés (35,714…) → 99 988 FC, à moins d'un demi-centime : soldé.
    expect(dollarsPourReste(100000, 2800)).toBe(35.71);
    expect(imputation("CDF", { devise: "USD", montant: 35.71 }, 2800, 100000)).toEqual({ impute: 100000, depasse: false, converti: true });
    // Un centime de plus (35,72 $ = 100 016 FC, 16 FC au-delà, plus qu'un demi-centime) : refusé.
    expect(imputation("CDF", { devise: "USD", montant: 35.72 }, 2800, 100000)).toEqual({ impute: 100016, depasse: true, converti: true });
    // Un centime de moins : paiement partiel (99 960 FC imputés, 40 FC restent).
    expect(imputation("CDF", { devise: "USD", montant: 35.7 }, 2800, 100000)).toEqual({ impute: 99960, depasse: false, converti: true });
  });
  it("taux absent ou nul alors qu'il faut convertir : null (jamais un taux supposé)", () => {
    expect(imputation("CDF", { devise: "USD", montant: 10 }, null, 100000)).toBeNull();
    expect(imputation("USD", { devise: "CDF", montant: 10 }, 0, 100)).toBeNull();
  });
});
