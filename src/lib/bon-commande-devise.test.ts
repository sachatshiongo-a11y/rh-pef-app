import { describe, it, expect } from "vitest";
import { bonDeListe, compterSansPrixBon, libelleTotalBon, libelleTotalGroupe, libelleTotalListe, prixLigneBon, totalBon } from "./bon-commande-devise";

describe("bon de commande : devise et lignes sans prix (audit du 10/10/2026, stock 19)", () => {
  it("un bon en francs lit son total en francs, jamais en dollars", () => {
    expect(totalBon({ devise: "CDF", totalUSD: null, totalCDF: "2300000" })).toBe(2300000);
    expect(totalBon({ devise: "USD", totalUSD: "447", totalCDF: "1028100" })).toBe(447); // l'équivalent figé d'avant n'est pas le total
    expect(totalBon({ totalUSD: "12" })).toBe(12); // absent = dollars (bons d'avant)
  });
  it("une ligne sans prix : prix nul OU 0 d'une ancienne saisie, jamais comptée comme un prix", () => {
    expect(prixLigneBon({ prixUnitaireUSD: null }, "USD")).toBeNull();
    expect(prixLigneBon({ prixUnitaireUSD: "0" }, "USD")).toBeNull();
    expect(prixLigneBon({ prixUnitaireUSD: "2.5" }, "USD")).toBe(2.5);
    expect(prixLigneBon({ prixUnitaireCDF: "50000" }, "CDF")).toBe(50000);
    expect(compterSansPrixBon([{ prixUnitaireUSD: null }, { prixUnitaireUSD: "3" }, { prixUnitaireUSD: 0 }], "USD")).toBe(2);
  });
  it("le total d'un bon dont des lignes n'ont pas de prix est annoncé incomplet", () => {
    expect(libelleTotalBon({ totalUSD: 120 }, 2, 5)).toBe("120,00 $ (incomplet : 2 ligne(s) sans prix)");
    expect(libelleTotalBon({ totalUSD: 120 }, 0, 5)).toBe("120,00 $");
  });
  it("« — » et jamais « 0,00 $ » quand rien n'est chiffré", () => {
    expect(libelleTotalBon({ totalUSD: 0 }, 3, 3)).toBe("— (incomplet : 3 ligne(s) sans prix)");
    expect(libelleTotalBon({ totalUSD: 0 }, 0, 0)).toBe("—");
    expect(libelleTotalBon({ totalUSD: null }, 0, 2)).toBe("—");
    expect(libelleTotalListe(bonDeListe({ totalUSD: 0 }, 2, 2))).toBe("— (incomplet)");
    expect(libelleTotalListe(bonDeListe({ totalUSD: 80 }, 1, 4))).toBe("80,00 $ (incomplet)");
  });
  it("un bon en francs s'écrit en francs", () => {
    expect(libelleTotalBon({ devise: "CDF", totalCDF: 2300000 }, 0, 3)).toMatch(/^2\s?300\s?000 FC$/);
  });
  it("le total d'un mois garde dollars et francs à part, et annonce l'incomplet", () => {
    const t = libelleTotalGroupe([
      { total: 100, devise: "USD", sansPrix: 0 },
      { total: 50, devise: "USD", sansPrix: 1 },
      { total: 1000000, devise: "CDF", sansPrix: 0 },
    ]);
    expect(t).toMatch(/^150,00 \$ \+ 1\s?000\s?000 FC · incomplet$/);
    expect(libelleTotalGroupe([{ total: 0, devise: "USD", sansPrix: 0 }])).toBe("—");
  });
});
