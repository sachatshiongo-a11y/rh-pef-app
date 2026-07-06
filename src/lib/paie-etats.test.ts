import { describe, expect, it } from "vitest";
import { transitionAutorisee, prochainsEtats, roleRequisPour } from "./paie-etats";

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

  it("réserve toutes les transitions de paie à l'ADMIN", () => {
    expect(roleRequisPour("VALIDE")).toEqual(["ADMIN"]);
    expect(roleRequisPour("PAYE")).toEqual(["ADMIN"]);
    expect(roleRequisPour("PAS_VALIDE")).toEqual(["ADMIN"]);
  });

  it("liste les états suivants possibles", () => {
    expect(prochainsEtats("PAS_VALIDE")).toEqual(["VALIDE"]);
    expect(prochainsEtats("VALIDE").sort()).toEqual(["PAS_VALIDE", "PAYE"]);
    expect(prochainsEtats("PAYE")).toEqual(["VALIDE"]);
  });
});
