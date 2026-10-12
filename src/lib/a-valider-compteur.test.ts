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

// ── Par rôle (V1) : chacun compte CE QU'IL VOIT, jamais les demandes des autres (annexe D) ───────
import { elementsAValiderPour, totalAValiderRHPour, totalAValiderExploitation, autresEnAttente, libelleAValider, BOITES_A_VALIDER } from "./a-valider-compteur";

const file: ElementsAValider = { conges: 4, fiches: 3, acomptes: 2, attestations: 1, echanges: 5, changements: 6, bulletinsAValider: 8, bulletinsAPayer: 7 };

describe("compteur « À valider » RH par rôle", () => {
  it("Direction : toute la file", () => {
    expect(totalAValiderRHPour("ADMIN", file, 0)).toBe(totalAValiderRH(file));
    expect(elementsAValiderPour("ADMIN", file, 0)).toEqual(file);
  });

  it("Responsable RH : ses demandes de fiche + ses deux gestes historiques (payer les bulletins validés, acter les shifts) — pas les congés, acomptes, attestations ni les fiches des autres", () => {
    expect(elementsAValiderPour("MANAGER", file, 2)).toEqual({ ...base, fiches: 2, bulletinsAPayer: 7, echanges: 5, changements: 6 });
    expect(totalAValiderRHPour("MANAGER", file, 2)).toBe(20);
    expect(totalAValiderRHPour("MANAGER", file, 0)).toBe(18);
  });

  it("consultation (VIEWER) : seulement ses propres demandes (en pratique aucune), aucun bulletin à payer", () => {
    expect(totalAValiderRHPour("VIEWER", file, 0)).toBe(0);
    expect(totalAValiderRHPour("VIEWER", file, 1)).toBe(1);
  });

  it("jamais plus que la Direction, jamais les chiffres d'autrui : la file des autres ne change rien au total d'un non-Direction", () => {
    const autre = { ...file, conges: 400, fiches: 300, acomptes: 200, attestations: 100, bulletinsAValider: 800 };
    for (const role of ["MANAGER", "VIEWER"]) expect(totalAValiderRHPour(role, autre, 1), role).toBe(totalAValiderRHPour(role, file, 1));
  });
});

describe("compteur « À valider » Exploitation", () => {
  it("les demandes de ratios en attente", () => {
    expect(totalAValiderExploitation({ demandesRatios: 0 })).toBe(0);
    expect(totalAValiderExploitation({ demandesRatios: 3 })).toBe(3);
  });
});

describe("rappel croisé et sélecteur d'espace (V11)", () => {
  it("les trois boîtes pointent vers des adresses distinctes, dans l'ordre RH · Stock · Exploitation", () => {
    expect(BOITES_A_VALIDER.map((b) => b.href)).toEqual(["/a-valider", "/stock/a-valider", "/exploitation/a-valider"]);
  });

  it("« Aussi en attente » : seulement les AUTRES espaces non vides", () => {
    expect(autresEnAttente("rh", { rh: 9, stock: 3, exploitation: 1 }).map((a) => `${a.nom} ${a.nombre}`)).toEqual(["Stock 3", "Exploitation 1"]);
    expect(autresEnAttente("stock", { rh: 9, stock: 3, exploitation: 1 }).map((a) => a.nom)).toEqual(["RH", "Exploitation"]);
    expect(autresEnAttente("rh", { rh: 9, stock: 0, exploitation: 1 }).map((a) => a.nom)).toEqual(["Exploitation"]);
    expect(autresEnAttente("exploitation", { rh: 9, stock: 0, exploitation: 1 })).toEqual([{ espace: "rh", nom: "RH", href: "/a-valider", nombre: 9 }]);
  });

  it("rien ailleurs : aucune ligne", () => {
    expect(autresEnAttente("rh", { rh: 9, stock: 0, exploitation: 0 })).toEqual([]);
  });

  it("libellé d'une carte du sélecteur", () => {
    expect(libelleAValider(4)).toBe("4 à valider");
    expect(libelleAValider(0)).toBe("Rien à valider");
  });
});
