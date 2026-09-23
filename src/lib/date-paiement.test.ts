import { describe, it, expect } from "vitest";
import { jourKinshasaISO, lireDatePaiement } from "./date-paiement";

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
