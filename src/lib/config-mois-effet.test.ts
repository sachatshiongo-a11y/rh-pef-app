import { describe, it, expect, vi } from "vitest";

// `config.ts` importe le client Prisma : on le neutralise, seule la fonction PURE est testée ici.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { lireMoisEffet } = await import("./config");

// Date d'effet de la paie sur heures planifiées, saisie en texte libre dans Paramètres : une valeur
// mal formée doit valoir `null` (ancienne règle partout), jamais une date d'effet fantaisiste.
describe("lireMoisEffet", () => {
  it("accepte un AAAAMM valide", () => {
    expect(lireMoisEffet(202609)).toBe(202609);
    expect(lireMoisEffet(202601)).toBe(202601);
    expect(lireMoisEffet(202612)).toBe(202612);
  });
  it("refuse « 9 » : la nouvelle règle passerait sur juin et juillet", () => {
    expect(lireMoisEffet(9)).toBeNull();
  });
  it("refuse un mois hors 1..12 (202613, 202600)", () => {
    expect(lireMoisEffet(202613)).toBeNull();
    expect(lireMoisEffet(202600)).toBeNull();
  });
  it("refuse un décimal, NaN, null, undefined et une année hors 2000..2100", () => {
    expect(lireMoisEffet(202609.5)).toBeNull();
    expect(lireMoisEffet(Number.NaN)).toBeNull();
    expect(lireMoisEffet(null)).toBeNull();
    expect(lireMoisEffet(undefined)).toBeNull();
    expect(lireMoisEffet(199912)).toBeNull();
    expect(lireMoisEffet(210101)).toBeNull();
  });
});
