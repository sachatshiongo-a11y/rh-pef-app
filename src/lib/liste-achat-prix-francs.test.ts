import { describe, it, expect } from "vitest";
import { avecArticle, avecDevise, puDuCatalogue, vide, type Art } from "./liste-achat-saisie";

// Liste d'achat — prix proposé d'un article dont le prix de référence est en FRANCS (2026-10-08) :
// dans la devise de la LIGNE ; même devise = le prix tel quel (aucun aller-retour), autre devise =
// converti au taux du jour. Un article en dollars : exactement comme avant.
const manioc: Art = { id: "m", designation: "Manioc", unite: "Kg", domaine: "NOURRITURE", prix: "7000", devisePrix: "CDF" };
const riz: Art = { id: "r", designation: "Riz", unite: "Kg", domaine: "NOURRITURE", prix: "2.5" };

describe("prix proposé dans la devise de la ligne", () => {
  it("article en FC, ligne en FC : 7 000 tel quel ; ligne en $ : ≈ au taux du jour (4 décimales)", () => {
    expect(puDuCatalogue("7000", "CDF", 2800, "CDF")).toBe("7000");
    expect(puDuCatalogue("7000", "USD", 2800, "CDF")).toBe("2,5");
    expect(puDuCatalogue("7000", "USD", 2850, "CDF")).toBe("2,4561");
    expect(puDuCatalogue("7000", "USD", 0, "CDF")).toBeNull(); // sans taux : rien, jamais 0
  });
  it("article en $ : comme avant", () => {
    expect(puDuCatalogue("2.5", "USD", 2800)).toBe("2,5");
    expect(puDuCatalogue("2.5", "CDF", 2800)).toBe("7000");
  });
  it("aller-retour de devise sur la ligne : on retombe sur le prix saisi, sans dérive", () => {
    const l = avecArticle({ ...vide("CDF"), qte: "2" }, manioc, 2850);
    expect([l.pu, l.montant, l.puCatalogueDevise]).toEqual(["7000", "14000", "CDF"]);
    const enDollars = avecDevise(l, "USD", 2850);
    expect(enDollars.pu).toBe("2,4561");
    expect(avecDevise(enDollars, "CDF", 2850).pu).toBe("7000");
  });
  it("article en $ : la ligne ne porte pas de devise de catalogue (inchangée)", () => {
    const l = avecArticle(vide("USD"), riz, 2800);
    expect(l.pu).toBe("2,5");
    expect("puCatalogueDevise" in l).toBe(false);
  });
});
