import { describe, it, expect } from "vitest";
import { arrondiCentimeFranc, sommeFrancs, totalLigneFrancs, bonDeListe, compterSansPrixBon, libelleTotalBon, libelleTotalGroupe, libelleTotalListe, prixLigneBon, totalBon } from "./bon-commande-devise";

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

describe("bon en francs : arithmétique exacte au centime de franc (revue du 2026-10-12)", () => {
  it("la moitié d'un centime s'arrondit vers le haut, là où Math.round(x * 100) / 100 se trompait", () => {
    // 2,26 × 41 740,75 = 94 334,095 exactement : le flottant donne 94 334,09 (faux), le décimal 94 334,10.
    expect(Math.round(2.26 * 41740.75 * 100) / 100).toBe(94334.09);
    expect(totalLigneFrancs(2.26, 41740.75)).toBe(94334.1);
    expect(totalLigneFrancs(11.19, 44116.5)).toBe(493663.64);
    expect(totalLigneFrancs(13.5, 24415.41)).toBe(329608.04);
  });
  it("prix arrondi au centime de franc avant le produit ; somme exacte", () => {
    expect(arrondiCentimeFranc(1.005)).toBe(1.01);
    expect(arrondiCentimeFranc("7000")).toBe(7000);
    expect(totalLigneFrancs(3, 0.335)).toBe(1.02); // 0,335 → 0,34 (centime) × 3
    expect(sommeFrancs([0.1, 0.2])).toBe(0.3); // 0,1 + 0,2 flottant = 0,30000000000000004
    expect(sommeFrancs([])).toBe(0);
  });
});
