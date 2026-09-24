import { describe, it, expect } from "vitest";
import { dureeShift } from "./duree-shift";

describe("dureeShift — durée d'un shift, source des heures planifiées de la paie", () => {
  it("durée explicite prioritaire (Admin 09:30–13:00 réglé à 3,5 h)", () => {
    expect(dureeShift({ heureDebut: "09:30", heureFin: "13:00", dureeHeures: 3.5 })).toBe(3.5);
  });
  it("durée explicite à 0 respectée", () => {
    expect(dureeShift({ heureDebut: "08:00", heureFin: "17:00", dureeHeures: 0 })).toBe(0);
  });
  it("sinon fin − début : Journée 08:00–22:30 = 14,5 h ; Caisse 10:30–22:30 = 12 h", () => {
    expect(dureeShift({ heureDebut: "08:00", heureFin: "22:30", dureeHeures: null })).toBe(14.5);
    expect(dureeShift({ heureDebut: "10:30", heureFin: "22:30", dureeHeures: null })).toBe(12);
  });
  it("shift de nuit : 23:00–06:00 = 7 h", () => {
    expect(dureeShift({ heureDebut: "23:00", heureFin: "06:00", dureeHeures: null })).toBe(7);
  });
  it("créneau système sans horaires (Repos/Congé/Férié) = 0 h", () => {
    expect(dureeShift({ heureDebut: null, heureFin: null, dureeHeures: null })).toBe(0);
  });
});
