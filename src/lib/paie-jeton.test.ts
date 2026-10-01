import { describe, it, expect } from "vitest";
import { ecartJeton, jetonLigne } from "./paie-jeton";

// Jeton des montants affichés : dollars au centime ET taux de change de la paie (2026-10-01).
describe("jeton des montants affichés", () => {
  const l = { salNetUSD: "300", salBrutUSD: 312.5, netImposableUSD: { toString: () => "290.1" } };

  it("dollars au centime et taux de la paie, séparés par « | »", () => {
    expect(jetonLigne(l, 2300)).toBe("300.00|312.50|290.10|2300.00");
  });

  it("stable : mêmes montants, même taux → même jeton (quelle que soit la forme des nombres)", () => {
    expect(jetonLigne({ salNetUSD: 300, salBrutUSD: "312.50", netImposableUSD: 290.1 }, "2300")).toBe(jetonLigne(l, 2300));
  });

  it("le taux seul a changé → « TAUX » ; un montant a changé → « MONTANTS » ; rien → « AUCUN »", () => {
    const affiche = jetonLigne(l, 2300);
    expect(ecartJeton(affiche, jetonLigne(l, 2300))).toBe("AUCUN");
    expect(ecartJeton(affiche, jetonLigne(l, 2500))).toBe("TAUX");
    expect(ecartJeton(affiche, jetonLigne({ ...l, salNetUSD: 301 }, 2300))).toBe("MONTANTS");
    expect(ecartJeton(affiche, jetonLigne({ ...l, salNetUSD: 301 }, 2500))).toBe("MONTANTS");
    // Un ancien jeton sans taux (page ouverte avant la mise à jour) : jamais pris pour un simple taux.
    expect(ecartJeton("300.00|312.50|290.10", jetonLigne(l, 2300))).toBe("MONTANTS");
  });
});
