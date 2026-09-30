import { describe, it, expect } from "vitest";
import { prixUnitaireAchat } from "./achats-liste";
import { cellulePrixUnitairePdf } from "./rapports-pdf";

// Exports de la Liste d'achat (demande Direction 2026-09-30) : prix unitaire de chaque ligne.
// Priorité à l'ACHAT (montant ÷ quantité, devise saisie), repli sur le CATALOGUE marqué comme tel,
// sinon inconnu — jamais 0.
const base = { quantite: 4, devise: null, montantOrigine: null, montantUSD: null, tauxChangeUtilise: null, prixCatalogueUSD: null } as const;

describe("prixUnitaireAchat — prix unitaire d'une ligne d'achat", () => {
  it("ligne en USD : montant ÷ quantité, en USD", () => {
    expect(prixUnitaireAchat({ ...base, devise: "USD", montantOrigine: "10", montantUSD: "10" })).toEqual({ valeur: 2.5, devise: "USD", equivalentUSD: 2.5, source: "achat" });
  });

  it("ligne en FC : montant ÷ quantité EN FRANCS, et son équivalent USD = montant USD figé ÷ quantité (pas le taux du jour)", () => {
    // 28 000 FC figés à 2 800 → 10 $ ; 4 unités → 7 000 FC l'unité ≈ 2,50 $.
    expect(prixUnitaireAchat({ ...base, devise: "CDF", montantOrigine: 28000, montantUSD: 10, tauxChangeUtilise: 2800 })).toEqual({ valeur: 7000, devise: "CDF", equivalentUSD: 2.5, source: "achat" });
    // Sans montant USD figé : équivalent au taux FIGÉ de la ligne ; sans taux non plus : inconnu.
    expect(prixUnitaireAchat({ ...base, devise: "CDF", montantOrigine: 28000, tauxChangeUtilise: 2800 })?.equivalentUSD).toBe(2.5);
    expect(prixUnitaireAchat({ ...base, devise: "CDF", montantOrigine: 28000 })?.equivalentUSD).toBeNull();
  });

  it("ligne ancienne sans devise ni montant d'origine, mais avec un montant USD : lue en USD", () => {
    expect(prixUnitaireAchat({ ...base, montantUSD: 6 })).toEqual({ valeur: 1.5, devise: "USD", equivalentUSD: 1.5, source: "achat" });
  });

  it("calcul impossible (montant absent, ou quantité nulle) : prix du CATALOGUE, marqué « catalogue »", () => {
    const cat = { valeur: 1.7, devise: "USD", equivalentUSD: 1.7, source: "catalogue" };
    expect(prixUnitaireAchat({ ...base, prixCatalogueUSD: "1.70" })).toEqual(cat);
    expect(prixUnitaireAchat({ ...base, quantite: 0, devise: "USD", montantOrigine: 10, montantUSD: 10, prixCatalogueUSD: 1.7 })).toEqual(cat);
  });

  it("ni achat ni catalogue : inconnu (null) — jamais 0", () => {
    expect(prixUnitaireAchat(base)).toBeNull();
    expect(prixUnitaireAchat({ ...base, prixCatalogueUSD: 0 })).toBeNull();
    expect(prixUnitaireAchat({ ...base, quantite: 0 })).toBeNull();
  });

  it("arrondi à 4 décimales (valeur calculable dans l'Excel)", () => {
    expect(prixUnitaireAchat({ ...base, quantite: 3, devise: "USD", montantOrigine: 1, montantUSD: 1 })?.valeur).toBe(0.3333);
  });
});

describe("cellulePrixUnitairePdf — prix unitaire lisible dans le PDF", () => {
  it("USD : « 2,50 $ » ; FC : « 7 000 FC » suivi de « ≈ 2,50 $ » ; catalogue : mention « catalogue » ; inconnu : « — »", () => {
    expect(cellulePrixUnitairePdf({ valeur: 2.5, devise: "USD", equivalentUSD: 2.5, source: "achat" })).toBe("2,50 $");
    expect(cellulePrixUnitairePdf({ valeur: 7000, devise: "CDF", equivalentUSD: 2.5, source: "achat" })).toEqual({ texte: "7 000 FC", note: "≈ 2,50 $" });
    expect(cellulePrixUnitairePdf({ valeur: 7000, devise: "CDF", equivalentUSD: null, source: "achat" })).toBe("7 000 FC");
    expect(cellulePrixUnitairePdf({ valeur: 1.7, devise: "USD", equivalentUSD: 1.7, source: "catalogue" })).toEqual({ texte: "1,70 $", note: "catalogue" });
    expect(cellulePrixUnitairePdf(null)).toBe("—");
  });

  it("aucune espace fine insécable (U+202F, absente d'Optima) dans le texte produit", () => {
    const c = cellulePrixUnitairePdf({ valeur: 1234567, devise: "CDF", equivalentUSD: 1234.5, source: "achat" }) as { texte: string; note: string };
    expect(`${c.texte}${c.note}`).not.toMatch(/[  ]/);
    expect(c).toEqual({ texte: "1 234 567 FC", note: "≈ 1 234,50 $" });
  });
});
