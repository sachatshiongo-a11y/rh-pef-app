import { describe, it, expect } from "vitest";
import { dateDuJourKinshasa, heuresNettes } from "./pointage-jour";

describe("dateDuJourKinshasa", () => {
  it("bascule au jour suivant dès minuit à Kinshasa (UTC+1)", () => {
    // 23:30 UTC = 00:30 à Kinshasa le lendemain
    expect(dateDuJourKinshasa(new Date("2026-09-22T23:30:00Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });
});

describe("heuresNettes", () => {
  it("8 h → 17 h avec 60 min de pause vaut 8", () => {
    const debut = new Date("2026-09-23T07:00:00Z"); // 8 h à Kinshasa
    const fin = new Date("2026-09-23T16:00:00Z"); // 17 h à Kinshasa
    expect(heuresNettes(debut, fin, 60)).toBe(8);
  });
  it("une pause plus longue que la journée donne 0, jamais un négatif", () => {
    const debut = new Date("2026-09-23T07:00:00Z");
    const fin = new Date("2026-09-23T08:00:00Z"); // 1 h travaillée
    expect(heuresNettes(debut, fin, 600)).toBe(0); // 10 h de pause > 1 h travaillée
  });
});
