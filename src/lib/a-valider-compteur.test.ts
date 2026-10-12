import { describe, it, expect } from "vitest";
import { totalAValiderRH, type ElementsAValider } from "./a-valider-compteur";

const base: ElementsAValider = { conges: 0, fiches: 0, acomptes: 0, attestations: 0, echanges: 0, changements: 0, bulletinsAValider: 0, bulletinsAPayer: 0 };

describe("compteur « À valider » RH — badge du menu et page comptent pareil", () => {
  it("rien en attente : 0", () => {
    expect(totalAValiderRH(base)).toBe(0);
  });

  it("chaque sorte de demande compte, attestations comprises (D2)", () => {
    for (const cle of Object.keys(base) as (keyof ElementsAValider)[]) {
      expect(totalAValiderRH({ ...base, [cle]: 1 }), cle).toBe(1);
    }
    expect(totalAValiderRH({ conges: 1, fiches: 2, acomptes: 3, attestations: 4, echanges: 5, changements: 6, bulletinsAValider: 8, bulletinsAPayer: 7 })).toBe(36);
  });

  it("les bulletins du mois à valider allument la pastille (décision du 2026-10-12)", () => {
    expect(totalAValiderRH({ ...base, bulletinsAValider: 24 })).toBe(24);
  });

  it("une demande d'attestation allume le badge à elle seule", () => {
    expect(totalAValiderRH({ ...base, attestations: 2 })).toBeGreaterThan(0);
  });
});

describe("compteur « À valider » Stock", () => {
  it("bons en brouillon + demandes en attente", async () => {
    const { totalAValiderStock } = await import("./a-valider-compteur");
    expect(totalAValiderStock({ bonsEnBrouillon: 0, demandes: 0 })).toBe(0);
    expect(totalAValiderStock({ bonsEnBrouillon: 2, demandes: 3 })).toBe(5);
  });
});
