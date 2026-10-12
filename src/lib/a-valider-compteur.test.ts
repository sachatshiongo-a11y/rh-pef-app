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
import {
  elementsAValiderPour, totalAValiderRHPour, totalAValiderExploitation, totalAValiderStock, totalAValiderCompte, libelleAValider, BOITES_A_VALIDER,
  espacesAValider, rubriquesRH, rubriquesVisibles, type CompteAValider,
} from "./a-valider-compteur";

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

describe("sélecteur d'espace (V11) et adresses de la page unique", () => {
  it("les trois boîtes pointent vers des adresses distinctes, dans l'ordre RH · Stock · Exploitation", () => {
    expect(BOITES_A_VALIDER.map((b) => b.href)).toEqual(["/a-valider", "/stock/a-valider", "/exploitation/a-valider"]);
    expect(BOITES_A_VALIDER.map((b) => b.espace)).toEqual(["rh", "stock", "exploitation"]);
  });

  it("libellé d'une carte du sélecteur", () => {
    expect(libelleAValider(4)).toBe("4 à valider");
    expect(libelleAValider(0)).toBe("Rien à valider");
  });
});

// ── LA MATRICE DES RÔLES de la page « À valider » unique et de sa pastille (2026-10-12) ──────────────────────────
// Pour chaque rôle : les espaces dont il lit la boîte, les rubriques qu'il voit et celles qu'il ne voit PAS, et le chiffre
// de la pastille — tous espaces confondus, chaque espace compté comme avant. Données : un état de la base où chaque file
// contient des éléments (les siens et ceux des autres), pour qu'une fuite change le chiffre.
describe("matrice des rôles — page « À valider » unique et pastille", () => {
  const stockToute = { bonsEnBrouillon: 2, demandes: 3 }; // 3 demandes en tout, dont 1 de ce compte
  const ratiosTous = 4; // 4 demandes de ratios en tout, dont 1 de ce compte
  const mesFiches = 2;
  const mienStock = 1;
  const mienRatios = 1;

  type Ligne = { nom: string; compte: CompteAValider; espaces: [boolean, boolean, boolean]; rh: string[]; stock: string[]; exploitation: string[]; pastille: number };
  const MATRICE: Ligne[] = [
    { nom: "ADMIN (Direction)", compte: { id: "d", role: "ADMIN" }, espaces: [true, true, true],
      rh: ["conges", "modifications-fiches", "acomptes", "attestations", "echanges", "changements", "bulletins-a-valider", "bulletins-a-payer"],
      stock: ["bons-de-commande", "demandes"], exploitation: ["demandes-ratios"], pastille: 36 + 5 + 4 },
    { nom: "MANAGER (Responsable RH)", compte: { id: "m", role: "MANAGER" }, espaces: [true, false, false],
      rh: ["modifications-fiches", "echanges", "changements", "bulletins-a-payer"], stock: [], exploitation: [], pastille: 2 + 5 + 6 + 7 },
    { nom: "VIEWER (consultation)", compte: { id: "v", role: "VIEWER" }, espaces: [true, false, false],
      rh: ["modifications-fiches"], stock: [], exploitation: [], pastille: 2 },
    { nom: "STOCK (magasinier)", compte: { id: "s", role: "STOCK" }, espaces: [false, true, false],
      rh: [], stock: ["bons-de-commande", "demandes"], exploitation: [], pastille: 2 + 1 },
    { nom: "COMPTA", compte: { id: "c", role: "COMPTA" }, espaces: [false, false, true],
      rh: [], stock: [], exploitation: ["demandes-ratios"], pastille: 1 },
    { nom: "EMPLOYE (salarié)", compte: { id: "e", role: "EMPLOYE" }, espaces: [false, false, false],
      rh: [], stock: [], exploitation: [], pastille: 0 },
    { nom: "EMPLOYE avec accès Stock", compte: { id: "e2", role: "EMPLOYE", accesStock: true }, espaces: [false, true, false],
      rh: [], stock: ["bons-de-commande", "demandes"], exploitation: [], pastille: 2 + 1 },
  ];

  /** La pastille d'un compte, composée comme les chargeurs : un espace qui n'est pas au compte vaut 0 et n'est pas lu. */
  const pastille = (c: CompteAValider) => {
    const e = espacesAValider(c);
    const admin = c.role === "ADMIN";
    return totalAValiderCompte({
      rh: e.rh ? totalAValiderRHPour(c.role, file, admin ? 0 : mesFiches) : 0,
      stock: e.stock ? totalAValiderStock({ bonsEnBrouillon: stockToute.bonsEnBrouillon, demandes: admin ? stockToute.demandes : mienStock }) : 0,
      exploitation: e.exploitation ? totalAValiderExploitation({ demandesRatios: admin ? ratiosTous : mienRatios }) : 0,
    });
  };

  it.each(MATRICE)("$nom : espaces, rubriques visibles et invisibles, pastille", ({ compte, espaces, rh, stock, exploitation, pastille: attendu }) => {
    const e = espacesAValider(compte);
    expect([e.rh, e.stock, e.exploitation]).toEqual(espaces);
    const v = rubriquesVisibles(compte);
    expect(v.rh).toEqual(rh);
    expect(v.stock).toEqual(stock);
    expect(v.exploitation).toEqual(exploitation);
    expect(pastille(compte)).toBe(attendu);
  });

  it("une rubrique qui n'est pas au compte est INVISIBLE : aucun rôle ne voit une rubrique d'un espace étranger", () => {
    const TOUTES = { rh: rubriquesRH("ADMIN"), stock: ["bons-de-commande", "demandes"], exploitation: ["demandes-ratios"] };
    for (const l of MATRICE) {
      const v = rubriquesVisibles(l.compte);
      for (const cle of ["rh", "stock", "exploitation"] as const) {
        const invisibles = TOUTES[cle].filter((r) => !(v[cle] as string[]).includes(r));
        if (!espacesAValider(l.compte)[cle]) expect(invisibles, `${l.nom} ${cle}`).toEqual(TOUTES[cle]);
      }
    }
  });

  it("jamais plus que la Direction : la pastille d'un compte est ≤ à celle de la Direction", () => {
    const direction = pastille({ id: "d", role: "ADMIN" });
    for (const l of MATRICE) expect(pastille(l.compte), l.nom).toBeLessThanOrEqual(direction);
  });

  it("les rubriques RH d'un rôle recouvrent exactement ce que son compteur compte (page et pastille ne divergent pas)", () => {
    // Pour chaque rôle RH, une rubrique non visible a un compteur nul : ce que la pastille compte est affiché sur la page.
    const parRubrique: Record<string, keyof ElementsAValider> = {
      conges: "conges", "modifications-fiches": "fiches", acomptes: "acomptes", attestations: "attestations",
      echanges: "echanges", changements: "changements", "bulletins-a-valider": "bulletinsAValider", "bulletins-a-payer": "bulletinsAPayer",
    };
    for (const role of ["ADMIN", "MANAGER", "VIEWER"]) {
      const compte = elementsAValiderPour(role, file, role === "ADMIN" ? 0 : mesFiches);
      const visibles = new Set(rubriquesRH(role));
      for (const [rubrique, cle] of Object.entries(parRubrique)) {
        if (!visibles.has(rubrique as never)) expect(compte[cle], `${role} ${rubrique}`).toBe(0);
      }
    }
  });

  it("totalAValiderCompte additionne les trois espaces", () => {
    expect(totalAValiderCompte({ rh: 1, stock: 2, exploitation: 4 })).toBe(7);
    expect(totalAValiderCompte({ rh: 0, stock: 0, exploitation: 0 })).toBe(0);
  });
});
