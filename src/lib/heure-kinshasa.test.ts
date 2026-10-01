import { describe, it, expect, vi } from "vitest";
import { dateHeureKinshasa, dateHeureGenerationKinshasa, heureKinshasa, jourKinshasa, jourCivilKinshasa, jourCourantKinshasaISO, moisCourantKinshasa, anneeCouranteKinshasa, numeroMoisCourantKinshasa } from "./heure-kinshasa";

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

// 2026-10-01 : à 00 h 19 à Kinshasa, le serveur (UTC) était encore le 30 septembre — les écrans
// prenaient septembre pour le mois courant alors que les sorties du jour étaient datées d'octobre.
describe("le « maintenant » civil de Kinshasa : jour, mois, année courants", () => {
  const PREMIER_00H30 = new Date("2026-09-30T23:30:00.000Z"); // 1er octobre, 00 h 30 à Kinshasa
  const DERNIER_23H30 = new Date("2026-10-31T22:30:00.000Z"); // 31 octobre, 23 h 30 à Kinshasa
  const NOUVEL_AN_00H30 = new Date("2026-12-31T23:30:00.000Z"); // 1er janvier 2027, 00 h 30 à Kinshasa

  it("le 1er du mois à 00 h 30 : déjà le mois (et le jour) neufs, alors que l'horloge UTC dit la veille", () => {
    expect(PREMIER_00H30.getUTCMonth() + 1).toBe(9); // l'horloge UTC : septembre
    expect(jourCourantKinshasaISO(PREMIER_00H30)).toBe("2026-10-01");
    expect(moisCourantKinshasa(PREMIER_00H30)).toBe("2026-10");
    expect(numeroMoisCourantKinshasa(PREMIER_00H30)).toBe(10);
    expect(anneeCouranteKinshasa(PREMIER_00H30)).toBe(2026);
  });

  it("le dernier jour du mois à 23 h 30 : même mois des deux côtés, rien ne change", () => {
    expect(DERNIER_23H30.getUTCMonth() + 1).toBe(10);
    expect(jourCourantKinshasaISO(DERNIER_23H30)).toBe("2026-10-31");
    expect(moisCourantKinshasa(DERNIER_23H30)).toBe("2026-10");
    expect(numeroMoisCourantKinshasa(DERNIER_23H30)).toBe(10);
  });

  it("le 1er janvier à 00 h 30 : l'année bascule aussi", () => {
    expect(NOUVEL_AN_00H30.getUTCFullYear()).toBe(2026);
    expect(anneeCouranteKinshasa(NOUVEL_AN_00H30)).toBe(2027);
    expect(moisCourantKinshasa(NOUVEL_AN_00H30)).toBe("2027-01");
    expect(numeroMoisCourantKinshasa(NOUVEL_AN_00H30)).toBe(1);
  });

  it("un jour quelconque, en milieu de journée : les deux horloges s'accordent", () => {
    const midi = new Date("2026-09-24T12:00:00.000Z");
    expect(jourCourantKinshasaISO(midi)).toBe("2026-09-24");
    expect(moisCourantKinshasa(midi)).toBe("2026-09");
  });

  it("sans argument : l'horloge courante (figée ici)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(PREMIER_00H30);
      expect(moisCourantKinshasa()).toBe("2026-10");
      expect(jourCourantKinshasaISO()).toBe("2026-10-01");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("« généré le … à HH:MM » des pieds et aperçus de rapport", () => {
  it("heure de Kinshasa (UTC+1), 24 h sur deux chiffres, jour de Kinshasa", () => {
    expect(dateHeureGenerationKinshasa(new Date("2026-10-01T04:28:00.000Z"))).toBe("01/10/2026 à 05:28");
    expect(dateHeureGenerationKinshasa(new Date("2026-09-30T23:30:00.000Z"))).toBe("01/10/2026 à 00:30"); // la veille UTC
    expect(dateHeureGenerationKinshasa(new Date("2026-10-31T22:30:00.000Z"))).toBe("31/10/2026 à 23:30");
    expect(dateHeureGenerationKinshasa(new Date("2026-10-01T04:28:00.000Z"))).not.toMatch(/[\u202F\u00A0]/);
  });
});
