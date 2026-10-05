import { describe, it, expect } from "vitest";
import { jourDuVersement, jourKinshasaISO, lireDatePaiement, lireDateVersementPaie } from "./date-paiement";

// Même instant piège que heure-kinshasa.test.ts : 23 h 30 UTC = 00 h 30 à Kinshasa le lendemain.
const MINUIT_ET_DEMIE_A_KINSHASA = new Date("2026-09-22T23:30:00.000Z"); // 23/09 00 h 30 à Kinshasa

describe("jourKinshasaISO", () => {
  it("un instant juste après minuit à Kinshasa reste encore la veille en UTC : le jour doit être celui de Kinshasa", () => {
    expect(jourKinshasaISO(MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
  });
});

describe("lireDatePaiement", () => {
  it("saisie absente ou vide → aujourd'hui à Kinshasa", () => {
    expect(lireDatePaiement(undefined, null, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
    expect(lireDatePaiement("  ", null, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
  });

  it("saisie illisible → refus", () => {
    expect(() => lireDatePaiement("hier", null, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/invalide/i);
    expect(() => lireDatePaiement("2026-02-30", null, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/invalide/i); // 30 février n'existe pas
    expect(() => lireDatePaiement("23/09/2026", null, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/invalide/i);
  });

  it("saisie dans le futur (après aujourd'hui à Kinshasa) → refus", () => {
    expect(() => lireDatePaiement("2026-09-24", null, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/ne peut pas être dans le futur/i);
  });

  it("saisie antérieure à la date de la facture → refus", () => {
    expect(() => lireDatePaiement("2026-09-01", "2026-09-10T00:00:00.000Z", MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/antérieure à la date de la facture/i);
  });

  it("saisie égale à la date de la facture → acceptée", () => {
    expect(lireDatePaiement("2026-09-10", "2026-09-10T00:00:00.000Z", MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-10");
  });

  it("date de facture inconnue (null) → aucun contrôle de cette borne", () => {
    expect(lireDatePaiement("2026-01-01", null, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-01-01");
  });
});

describe("lireDateVersementPaie (versement des salaires)", () => {
  const SEPTEMBRE = { mois: 9, annee: 2026 };

  it("saisie absente ou vide → aujourd'hui à Kinshasa", () => {
    expect(lireDateVersementPaie(undefined, SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
    expect(lireDateVersementPaie(null, SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
    expect(lireDateVersementPaie("  ", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
  });

  it("saisie illisible (format ou calendrier) → refus, dans les mots du versement", () => {
    expect(() => lireDateVersementPaie("hier", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow("Date de versement invalide.");
    expect(() => lireDateVersementPaie("2026-02-30", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow("Date de versement invalide.");
    expect(() => lireDateVersementPaie("23/09/2026", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow("Date de versement invalide.");
  });

  it("date future (après aujourd'hui à Kinshasa) → refus ; aujourd'hui lui-même est accepté", () => {
    expect(() => lireDateVersementPaie("2026-09-24", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow("La date de versement ne peut pas être dans le futur.");
    expect(lireDateVersementPaie("2026-09-23", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-23");
    // 23 h 30 UTC le 22 = déjà le 23 à Kinshasa : le 23 n'est PAS une date future.
  });

  it("antérieure au 1er jour du mois de la paie → refus, avec le jour et le mois en clair", () => {
    expect(() => lireDateVersementPaie("2026-08-31", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA))
      .toThrow("La date de versement (31/08/2026) ne peut pas être antérieure au 1er jour du mois de la paie (septembre 2026).");
  });

  it("le 1er du mois de la paie est accepté ; une paie de décembre n'est pas confondue avec janvier", () => {
    expect(lireDateVersementPaie("2026-09-01", SEPTEMBRE, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2026-09-01");
    const apres = new Date("2027-01-15T10:00:00.000Z");
    expect(lireDateVersementPaie("2026-12-01", { mois: 12, annee: 2026 }, apres)).toBe("2026-12-01");
    expect(() => lireDateVersementPaie("2026-11-30", { mois: 12, annee: 2026 }, apres)).toThrow(/antérieure au 1er jour du mois de la paie \(décembre 2026\)/);
  });

  it("sans paie connue (contrôle d'entrée d'un lot), seule la lecture et le futur sont contrôlés", () => {
    expect(lireDateVersementPaie("2020-01-01", null, MINUIT_ET_DEMIE_A_KINSHASA)).toBe("2020-01-01");
    expect(() => lireDateVersementPaie("2026-09-24", null, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/futur/);
  });

  it("absente et paie d'un mois pas encore commencé → refus (aujourd'hui précède le 1er du mois)", () => {
    expect(() => lireDateVersementPaie(undefined, { mois: 10, annee: 2026 }, MINUIT_ET_DEMIE_A_KINSHASA)).toThrow(/antérieure au 1er jour du mois de la paie \(octobre 2026\)/);
  });
});

describe("jourDuVersement", () => {
  it("transforme le jour ISO en date pure (minuit UTC), comme les autres dates civiles stockées", () => {
    expect(jourDuVersement("2026-09-23").toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });
});
