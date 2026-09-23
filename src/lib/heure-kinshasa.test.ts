import { describe, it, expect } from "vitest";
import { dateHeureKinshasa, jourKinshasa, jourCivilKinshasa } from "./heure-kinshasa";

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
  });
});
