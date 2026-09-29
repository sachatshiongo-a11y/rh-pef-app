import { describe, it, expect } from "vitest";
import { dateHeureKinshasa, heureKinshasa, jourKinshasa, jourCivilKinshasa } from "./heure-kinshasa";

// Le serveur tourne en UTC, Kinshasa en UTC+1 : entre minuit et une heure à Kinshasa, l'instant
// est encore la VEILLE en UTC. C'est la fenêtre où un formatage « à l'heure du serveur » ment.
const MINUIT_ET_DEMIE_A_KINSHASA = new Date("2026-09-22T23:30:00.000Z"); // 23/09 00 h 30 à Kinshasa

describe("heure de Kinshasa", () => {
  it("un instant entre minuit et une heure tombe sur le jour de Kinshasa, pas la veille UTC", () => {
    expect(jourKinshasa(MINUIT_ET_DEMIE_A_KINSHASA)).toBe("23/09/2026");
    expect(dateHeureKinshasa(MINUIT_ET_DEMIE_A_KINSHASA)).toBe("23/09/2026 à 00 h 30");
  });

  it("le jour civil de Kinshasa est rendu comme une date pure (minuit UTC de ce jour)", () => {
    expect(jourCivilKinshasa(MINUIT_ET_DEMIE_A_KINSHASA).toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(jourCivilKinshasa(new Date("2026-09-23T12:00:00.000Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });

  it("aucune espace fine insécable (absente d'Optima) dans ce qui part au PDF", () => {
    expect(dateHeureKinshasa(MINUIT_ET_DEMIE_A_KINSHASA)).not.toMatch(/[  ]/);
    expect(heureKinshasa(MINUIT_ET_DEMIE_A_KINSHASA)).not.toMatch(/[\u202F\u00A0]/);
  });

  it("l'heure seule, à la façon de l'écran de pointage : « 8 h 02 », sans zéro devant l'heure", () => {
    expect(heureKinshasa(new Date("2026-09-23T07:02:00.000Z"))).toBe("8 h 02");
    expect(heureKinshasa(new Date("2026-09-23T16:45:00.000Z"))).toBe("17 h 45");
    expect(heureKinshasa(MINUIT_ET_DEMIE_A_KINSHASA)).toBe("0 h 30"); // pas « 24 h 30 », pas la veille UTC
  });
});

// 2026-09-29 : l'espace salarié et la fiche employé calculaient « aujourd'hui à Kinshasa » par
// `new Date(Date.now() + 3_600_000)` (règle react-hooks/purity en erreur). Ils lisent désormais
// `jourCivilKinshasa(new Date())`. Seuls l'année, le mois et le jour de cet instant décalé servaient :
// les deux formes doivent donner le MÊME jour, y compris autour de minuit et en fin de mois/d'année.
describe("jourCivilKinshasa remplace le décalage d'une heure à la main", () => {
  const ancien = (d: Date) => {
    const k = new Date(d.getTime() + 3_600_000);
    return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  };
  for (const iso of [
    "2026-09-28T22:59:59.999Z", // 23 h 59 à Kinshasa : encore le 28
    "2026-09-28T23:00:00.000Z", // minuit à Kinshasa : déjà le 29
    "2026-09-29T00:30:00.000Z",
    "2026-09-30T23:30:00.000Z", // bascule de mois
    "2026-12-31T23:00:00.000Z", // bascule d'année
    "2026-03-29T01:30:00.000Z", // passage à l'heure d'été européenne : sans effet à Kinshasa
    "2026-10-25T01:30:00.000Z",
  ]) {
    it(iso, () => {
      const d = new Date(iso);
      expect(jourCivilKinshasa(d).toISOString()).toBe(ancien(d).toISOString());
    });
  }
});
