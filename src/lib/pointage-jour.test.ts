import { describe, it, expect } from "vitest";
import { dateDuJourKinshasa, heuresPayables, pauseDeduiteMinutes, pauseDuJour } from "./pointage-jour";
import { LIBELLE_PAUSE_PAR_DEFAUT, PAUSE_PAR_DEFAUT_MIN, libellePause } from "./pointage-qr";

describe("dateDuJourKinshasa", () => {
  it("bascule au jour suivant dès minuit à Kinshasa (UTC+1)", () => {
    // 23:30 UTC = 00:30 à Kinshasa le lendemain
    expect(dateDuJourKinshasa(new Date("2026-09-22T23:30:00Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });
});

// Décision d'argent de la Direction du 2026-09-29 : « la paie ne doit pas être affectée » — la pause
// par défaut s'affiche mais n'est pas déduite ; une pause saisie par le salarié l'est.
describe("heuresPayables — la seule fonction qui retire une pause des heures d'un pointage", () => {
  const heureDebut = new Date("2026-09-23T07:00:00Z"); // 8 h à Kinshasa
  const heureFin = new Date("2026-09-23T16:00:00Z"); // 17 h à Kinshasa

  it("pause PAR DÉFAUT : heures payées = départ − arrivée, rien n'est retiré", () => {
    // Forme stockée (0 min déduite + drapeau)…
    expect(heuresPayables({ heureDebut, heureFin, pauseMinutes: 0, pauseParDefaut: true })).toBe(9);
    // …et une ligne qui porterait encore 30 min avec le drapeau : le drapeau l'emporte, rien de retiré.
    expect(heuresPayables({ heureDebut, heureFin, pauseMinutes: PAUSE_PAR_DEFAUT_MIN, pauseParDefaut: true })).toBe(9);
  });

  it("identique à une journée SANS pause", () => {
    expect(heuresPayables({ heureDebut, heureFin, pauseMinutes: 0, pauseParDefaut: true })).toBe(
      heuresPayables({ heureDebut, heureFin, pauseMinutes: 0, pauseParDefaut: false }),
    );
  });

  it("pause SAISIE de 45 min : déduite", () => {
    expect(heuresPayables({ heureDebut, heureFin, pauseMinutes: 45, pauseParDefaut: false })).toBe(8.25);
  });

  it("pause saisie de 30 min (après la pause par défaut) : 30 min déduites", () => {
    expect(heuresPayables({ heureDebut, heureFin, pauseMinutes: 30, pauseParDefaut: false })).toBe(8.5);
  });

  it("une pause plus longue que la journée donne 0, jamais un négatif ; une pause négative ne rajoute rien", () => {
    const uneHeure = new Date("2026-09-23T08:00:00Z");
    expect(heuresPayables({ heureDebut, heureFin: uneHeure, pauseMinutes: 600, pauseParDefaut: false })).toBe(0);
    expect(heuresPayables({ heureDebut, heureFin: uneHeure, pauseMinutes: -60, pauseParDefaut: false })).toBe(1);
  });

  it("arrondi au centième", () => {
    const fin = new Date("2026-09-23T15:33:00Z"); // 8 h 33
    expect(heuresPayables({ heureDebut, heureFin: fin, pauseMinutes: 0, pauseParDefaut: true })).toBe(8.55);
  });
});

describe("pauseDuJour / libellePause — ce que l'écran reçoit et affiche", () => {
  it("pause par défaut : 0 min déduite, libellée « pause par défaut 30 min (non déduite) »", () => {
    const p = pauseDuJour({ pauseMinutes: 0, pauseParDefaut: true });
    expect(p).toEqual({ parDefaut: true, minutesDeduites: 0 });
    expect(pauseDeduiteMinutes({ pauseMinutes: 30, pauseParDefaut: true })).toBe(0);
    expect(libellePause(p)).toBe("pause par défaut 30 min (non déduite)");
    expect(LIBELLE_PAUSE_PAR_DEFAUT).toBe("pause par défaut 30 min (non déduite)");
  });
  it("pause saisie : ses minutes, déduites", () => {
    const p = pauseDuJour({ pauseMinutes: 45, pauseParDefaut: false });
    expect(p).toEqual({ parDefaut: false, minutesDeduites: 45 });
    expect(libellePause(p)).toBe("pause 45 min");
  });
});
