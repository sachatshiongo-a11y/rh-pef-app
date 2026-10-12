import { describe, expect, it } from "vitest";
import { parseMontant, lireTotalBonCommande, extraireLignesBonCommande, extraireLignesBonCommandeEn } from "./import-bc-pdf";

const extraireTotalBonCommande = (texte: string) => lireTotalBonCommande(texte).montant;

describe("parseMontant — tous les formats rencontrés sur les BC/factures", () => {
  const cas: [string, number][] = [
    ["150.00", 150],
    ["150,00", 150],
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["1.500", 1500], // groupe de milliers
    ["1,500", 1500],
    ["12.5", 12.5],
    ["48.06", 48.06],
    ["4.24137931", 4.24137931], // décimales longues (formule Excel)
    ["2 300", 2300],
    ["27", 27],
  ];
  for (const [entree, attendu] of cas) {
    it(`« ${entree} » → ${attendu}`, () => {
      expect(parseMontant(entree)).toBeCloseTo(attendu, 2);
    });
  }
});

describe("extraireTotalBonCommande — le total vit sur sa propre ligne", () => {
  it("ligne « montant pur » à la française (espaces de milliers)", () => {
    const texte = "GRANA PADANO 1KG 15,00 1,00 15,00 32,00 $ 480,00 $\n1 112,02 $";
    expect(extraireTotalBonCommande(texte)).toBe(1112.02);
  });
  it("ligne étiquetée TOTAL au format US", () => {
    const texte = "ELLE & VIRE COOKING CREAM 1LTR 24.00 1.00 24.00 9.00 $ 216.00 $\nTOTAL 447.00 $";
    expect(extraireTotalBonCommande(texte)).toBe(447);
  });
  it("ne fusionne JAMAIS les colonnes d'une ligne d'articles (bug historique)", () => {
    const texte = "15 SPAGHETTI 12,00 3,00 36,00 3,50 $ 126,00 $\n126,00 $";
    expect(extraireTotalBonCommande(texte)).toBe(126);
  });
  it("aucun total imprimé → 0 (on garde la valeur existante)", () => {
    const texte = "CARRÉ D'AGNEAU 1KG 5 49.42 $\nMontant total";
    expect(extraireTotalBonCommande(texte)).toBe(0);
  });
  it("total en francs : la devise lue fait foi, JAMAIS converti au taux du jour", () => {
    const texte = "SEL 10 000 FC\nTOTAL 2 300 000 FC";
    expect(lireTotalBonCommande(texte)).toEqual({ montant: 2300000, devise: "CDF" });
  });
  it("un total en dollars l'emporte, comme avant (devise USD)", () => {
    expect(lireTotalBonCommande("TOTAL 447.00 $\n1 250 000 FC")).toEqual({ montant: 447, devise: "USD" });
  });
  it("rien de lu : 0 en dollars", () => {
    expect(lireTotalBonCommande("Montant total")).toEqual({ montant: 0, devise: "USD" });
  });
});

describe("extraireLignesBonCommande", () => {
  it("lit désignation, quantité (N × PU ≈ total), PU et total", () => {
    const texte = "Réf Désignation Qté PU Montant\nGRANA PADANO 1KG 15,00 1,00 15,00 32,00 $ 480,00 $\nTOTAL 480,00 $";
    const lignes = extraireLignesBonCommande(texte);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].designation).toContain("GRANA PADANO");
    expect(lignes[0].prixUnitaireUSD).toBe(32);
    expect(lignes[0].totalLigneUSD).toBe(480);
    expect(lignes[0].quantite).toBe(15);
  });
  it("s'arrête à la ligne de total", () => {
    const texte = "LEFFE BLONDE 330 ML 24,00 2,17 $ 52,01 $\nMontant total 52,01 $\nPIED DE PAGE 99,99 $";
    expect(extraireLignesBonCommande(texte)).toHaveLength(1);
  });
});

describe("extraireLignesBonCommandeEn — bon en francs", () => {
  it("lit les lignes en francs avec leurs montants en francs (rien n'est converti)", () => {
    const texte = "Réf Désignation Qté PU Montant\nFARINE 25KG 10,00 50 000 FC 500 000 FC\nTOTAL 500 000 FC";
    const lignes = extraireLignesBonCommandeEn(texte, "CDF");
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ prixUnitaire: 50000, totalLigne: 500000, quantite: 10 });
    expect(lignes[0].designation).toContain("FARINE");
    expect(extraireLignesBonCommandeEn(texte, "USD")).toHaveLength(0); // aucun « $ » : pas de ligne en dollars
  });
});
