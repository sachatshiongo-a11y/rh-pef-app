import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { ligneDiffere } from "./paie-validation";
import type { DonneesLignePaie } from "./paie-batch";

// Comparaison « au centime près » d'une ligne enregistrée (Decimal(·, 2)) et de son recalcul (nombre
// JavaScript non arrondi) : un centime d'écart refuse, l'arrondi de la base n'en est pas un.
const D = (v: string) => new Prisma.Decimal(v);
const enregistree = {
  sourceReference: "PLANNING",
  salNetUSD: D("400.00"),
  salBrutUSD: D("452.35"),
  netImposableUSD: D("429.73"),
  heuresContractuelles: D("216.67"),
  heuresTravaillees: D("216.00"),
  heuresPayeesNonTravaillees: D("0.00"),
};
const recalculee = (surcharge: Partial<DonneesLignePaie> = {}) => ({
  sourceReference: "PLANNING",
  salNetUSD: 400,
  salBrutUSD: 452.345, // enregistré 452.35 : arrondi à mi-chemin loin de zéro, comme Postgres
  netImposableUSD: 429.7288,
  heuresContractuelles: 216.66666666666666,
  heuresTravaillees: 216,
  heuresPayeesNonTravaillees: 0,
  ...surcharge,
}) as DonneesLignePaie;

describe("ligneDiffere", () => {
  it("recalcul identique à l'arrondi de la base près : pas d'écart", () => {
    expect(ligneDiffere(enregistree, recalculee())).toBe(false);
  });

  it("un centime d'écart sur le net, le brut ou la base imposable : écart", () => {
    expect(ligneDiffere(enregistree, recalculee({ salNetUSD: 400.01 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ salNetUSD: 399.99 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ salBrutUSD: 452.36 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ netImposableUSD: 429.72 }))).toBe(true);
  });

  it("heures de référence, faites ou payées non travaillées changées : écart", () => {
    expect(ligneDiffere(enregistree, recalculee({ heuresContractuelles: 225.67 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ heuresTravaillees: 207 }))).toBe(true);
    expect(ligneDiffere(enregistree, recalculee({ heuresPayeesNonTravaillees: 9 }))).toBe(true);
  });

  it("source de la référence changée (planning → repli contrat) : écart, même à montant égal", () => {
    expect(ligneDiffere(enregistree, recalculee({ sourceReference: "CONTRAT_REPLI" }))).toBe(true);
  });
});
