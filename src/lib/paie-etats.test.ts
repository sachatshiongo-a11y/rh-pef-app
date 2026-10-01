import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { transitionAutorisee, transitionAutoriseeEnLot, prochainsEtats, roleRequisPour, transitionPermise, prochainsEtatsPour, ROLES_CLOTURE, cloturePeutValider } from "./paie-etats";

describe("machine à états de paie (3 états)", () => {
  it("suit le flux nominal Pas validé → Validé → Payé", () => {
    expect(transitionAutorisee("PAS_VALIDE", "VALIDE")).toBe(true);
    expect(transitionAutorisee("VALIDE", "PAYE")).toBe(true);
  });

  it("interdit les sauts d'étape", () => {
    expect(transitionAutorisee("PAS_VALIDE", "PAYE")).toBe(false);
  });

  it("permet la réouverture pour corriger (tracée à l'audit)", () => {
    expect(transitionAutorisee("VALIDE", "PAS_VALIDE")).toBe(true);
    expect(transitionAutorisee("PAYE", "VALIDE")).toBe(true);
  });

  it("un état payé ne revient pas directement à « pas validé »", () => {
    expect(transitionAutorisee("PAYE", "PAS_VALIDE")).toBe(false);
  });

  it("la Direction valide et revient en arrière ; la Direction ET la RH paient", () => {
    expect(roleRequisPour("VALIDE")).toEqual(["ADMIN"]);
    expect(roleRequisPour("PAYE")).toEqual(["ADMIN", "MANAGER"]);
    expect(roleRequisPour("PAS_VALIDE")).toEqual(["ADMIN"]);
  });

  // Matrice complète rôle × transition (2026-10-01) : une seule case s'ouvre à la RH, aucune aux autres.
  const ROLES: Role[] = ["ADMIN", "MANAGER", "COMPTA", "VIEWER", "STOCK", "EMPLOYE"];
  const CAS = [
    { nom: "valider", de: "PAS_VALIDE", vers: "VALIDE", permis: ["ADMIN"] },
    { nom: "payer", de: "VALIDE", vers: "PAYE", permis: ["ADMIN", "MANAGER"] },
    { nom: "rouvrir", de: "VALIDE", vers: "PAS_VALIDE", permis: ["ADMIN"] },
    { nom: "annuler le paiement", de: "PAYE", vers: "VALIDE", permis: ["ADMIN"] },
    { nom: "payer un bulletin non validé", de: "PAS_VALIDE", vers: "PAYE", permis: [] },
  ] as const;
  for (const c of CAS) {
    it.each(ROLES)(`${c.nom} : %s`, (role) => {
      expect(transitionPermise(role, c.de, c.vers)).toBe((c.permis as readonly Role[]).includes(role));
    });
  }

  it("en lot : la RH paie les validés, jamais un non validé ; personne n'annule un paiement en lot", () => {
    expect(transitionPermise("MANAGER", "VALIDE", "PAYE", { enLot: true })).toBe(true);
    expect(transitionPermise("MANAGER", "PAS_VALIDE", "PAYE", { enLot: true })).toBe(false);
    expect(transitionPermise("ADMIN", "PAYE", "VALIDE", { enLot: true })).toBe(false);
  });

  it.each(ROLES)("clôture : %s", (role) => {
    // Direction et RH clôturent ; seule la Direction valide des bulletins en clôturant.
    expect(ROLES_CLOTURE.includes(role)).toBe(role === "ADMIN" || role === "MANAGER");
    expect(cloturePeutValider(role)).toBe(role === "ADMIN");
  });

  it("boutons d'une ligne : la RH n'a que « Marquer payé », sur une ligne validée", () => {
    expect(prochainsEtatsPour("MANAGER", "PAS_VALIDE")).toEqual([]);
    expect(prochainsEtatsPour("MANAGER", "VALIDE")).toEqual(["PAYE"]);
    expect(prochainsEtatsPour("MANAGER", "PAYE")).toEqual([]);
    expect(prochainsEtatsPour("ADMIN", "VALIDE").sort()).toEqual(["PAS_VALIDE", "PAYE"]);
    for (const role of ["COMPTA", "VIEWER", "STOCK", "EMPLOYE"] as Role[]) {
      for (const de of ["PAS_VALIDE", "VALIDE", "PAYE"] as const) expect(prochainsEtatsPour(role, de)).toEqual([]);
    }
  });

  it("liste les états suivants possibles", () => {
    expect(prochainsEtats("PAS_VALIDE")).toEqual(["VALIDE"]);
    expect(prochainsEtats("VALIDE").sort()).toEqual(["PAS_VALIDE", "PAYE"]);
    expect(prochainsEtats("PAYE")).toEqual(["VALIDE"]);
  });

  it("en lot, « Valider » n'annule jamais un paiement (ligne payée cochée par mégarde)", () => {
    expect(transitionAutoriseeEnLot("PAYE", "VALIDE")).toBe(false);
    expect(transitionAutorisee("PAYE", "VALIDE")).toBe(true); // toujours possible ligne par ligne
    expect(transitionAutoriseeEnLot("PAS_VALIDE", "VALIDE")).toBe(true);
    expect(transitionAutoriseeEnLot("VALIDE", "PAYE")).toBe(true);
    expect(transitionAutoriseeEnLot("VALIDE", "PAS_VALIDE")).toBe(true);
  });
});
