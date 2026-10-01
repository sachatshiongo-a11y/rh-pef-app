import { describe, it, expect } from "vitest";
import { moisDe, moisDuParametre, lundiDe, lundiCourantKinshasa } from "./dates-fr";

// `moisDe` et `lundiDe` lisent des dates PURES (minuit UTC d'un jour civil) : ils ne changent pas.
// Le « maintenant » (mois courant, lundi courant) passe, lui, par l'heure de Kinshasa.
const PREMIER_00H30 = new Date("2026-09-30T23:30:00.000Z"); // jeudi 1er octobre, 00 h 30 à Kinshasa
const DERNIER_23H30 = new Date("2026-10-31T22:30:00.000Z"); // samedi 31 octobre, 23 h 30 à Kinshasa
const DIMANCHE_23H30 = new Date("2026-10-04T23:30:00.000Z"); // lundi 5 octobre, 00 h 30 à Kinshasa
const DIMANCHE_22H30 = new Date("2026-10-04T22:30:00.000Z"); // dimanche 4 octobre, 23 h 30 à Kinshasa

describe("moisDuParametre — le repli est le mois civil de Kinshasa", () => {
  it("le 1er du mois à 00 h 30 : le mois neuf, pas celui de l'horloge UTC", () => {
    expect(moisDuParametre(undefined, PREMIER_00H30)).toBe("2026-10");
    expect(moisDuParametre("n'importe quoi", PREMIER_00H30)).toBe("2026-10");
  });
  it("le dernier jour du mois à 23 h 30 : même mois des deux côtés", () => {
    expect(moisDuParametre(undefined, DERNIER_23H30)).toBe("2026-10");
  });
  it("un mois valide de l'URL prime toujours", () => {
    expect(moisDuParametre("2026-08", PREMIER_00H30)).toBe("2026-08");
  });
});

describe("moisDe — une date PURE se lit en UTC (inchangé)", () => {
  it("une date stockée au 1er octobre (minuit UTC) est en octobre", () => {
    expect(moisDe(new Date("2026-10-01T00:00:00.000Z"))).toBe("2026-10");
    expect(moisDe(new Date("2026-09-30T00:00:00.000Z"))).toBe("2026-09");
  });
});

describe("lundiCourantKinshasa — la semaine en cours lundi → dimanche, à l'heure de Kinshasa", () => {
  it("dimanche 23 h 30 UTC = déjà lundi à Kinshasa : la semaine neuve", () => {
    expect(lundiDe(DIMANCHE_23H30).toISOString()).toBe("2026-09-28T00:00:00.000Z"); // l'ancien calcul : la semaine finie
    expect(lundiCourantKinshasa(DIMANCHE_23H30).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
  it("dimanche 23 h 30 à Kinshasa : encore la semaine qui se termine, des deux côtés", () => {
    expect(lundiCourantKinshasa(DIMANCHE_22H30).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(lundiDe(DIMANCHE_22H30).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });
  it("un mercredi en milieu de journée : le lundi de la semaine", () => {
    expect(lundiCourantKinshasa(new Date("2026-09-30T10:00:00.000Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });
});
