import { describe, it, expect } from "vitest";
import { absencesDuMois, type JourAbsence } from "./paie-absences";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const jours = (codes: Record<number, [JourAbsence["code"], boolean?]>): JourAbsence[] =>
  Array.from({ length: 31 }, (_, i) => {
    const c = codes[i + 1];
    return { date: new Date(Date.UTC(2026, 9, i + 1)), code: c?.[0] ?? null, maladieJustifiee: c?.[1] ?? false };
  });
const base = { mois: 10, annee: 2026, joursCongeSansSolde: [] as string[], joursFeries: new Set<string>(), dateEmbauche: d("2025-01-06"), dateFinContrat: null };

describe("absencesDuMois (décisions Direction 2026-10-12)", () => {
  it("N et S comptés sur les jours ouvrables ; un N un dimanche ne compte pas ; congé sans solde approuvé compté une fois", () => {
    const a = absencesDuMois({ ...base, jours: jours({ 1: ["N"], 2: ["S"], 4: ["N"], 5: ["S"] }), joursCongeSansSolde: ["2026-10-05", "2026-10-06"] });
    expect(a.joursAbsenceRetenus).toBe(4); // 01, 02, 05, 06 (04 = dimanche)
    expect(a.prorata).toBeNull();
  });
  it("maladie : justifiés et non justifiés séparés", () => {
    const a = absencesDuMois({ ...base, jours: jours({ 7: ["M"], 8: ["M"], 9: ["M", true] }) });
    expect([a.joursMaladieNonJustifies, a.joursMaladieJustifies]).toEqual([2, 1]);
  });
  it("entrée le 15/10/2026 : 15 jours ouvrables sur 27 ; un N avant l'embauche ne compte pas", () => {
    const a = absencesDuMois({ ...base, dateEmbauche: d("2026-10-15"), jours: jours({ 2: ["N"] }) });
    expect(a.prorata).toEqual({ joursTravailles: 15, joursMois: 27 });
    expect(a.joursAbsenceRetenus).toBe(0);
  });
  it("sortie le 10/10/2026 (fin de contrat) : 9 jours ouvrables sur 27, un férié exclu des deux", () => {
    const a = absencesDuMois({ ...base, dateFinContrat: d("2026-10-10"), joursFeries: new Set(["2026-10-13"]), jours: jours({}) });
    expect(a.prorata).toEqual({ joursTravailles: 9, joursMois: 26 });
  });
});
