import { describe, it, expect } from "vitest";
import { compterJoursOuvrables, finApresJoursOuvrables } from "./jours-ouvrables";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("compterJoursOuvrables — dimanches et fériés exclus (déplacé depuis payroll.ts)", () => {
  // Lundi 29 juin → dimanche 5 juillet 2026 : 7 jours calendaires, 1 dimanche.
  it("exclut les dimanches", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"))).toBe(6);
  });
  it("exclut aussi les jours fériés fournis (Date ou AAAA-MM-JJ)", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), [d("2026-06-30")])).toBe(5);
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), ["2026-06-30"])).toBe(5);
  });
  it("un férié tombant un dimanche n'est pas déduit deux fois", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), [d("2026-07-05")])).toBe(6);
  });
  it("fin avant début → 0", () => {
    expect(compterJoursOuvrables(d("2026-07-05"), d("2026-06-29"))).toBe(0);
  });
});

describe("finApresJoursOuvrables — la date de fin pour N jours ouvrables à partir du début", () => {
  it("1 jour un lundi → ce lundi (début inclus)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 1))).toBe("2026-06-29");
  });
  it("6 jours un lundi → le samedi (le samedi est ouvrable)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 6))).toBe("2026-07-04");
  });
  it("7 jours un lundi → le lundi suivant (le dimanche est sauté)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 7))).toBe("2026-07-06");
  });
  it("début un dimanche, 1 jour → le lundi (le dimanche ne compte pas)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-28"), 1))).toBe("2026-06-29");
  });
  it("férié en plein milieu → la fin recule d'un jour", () => {
    // 29 juin → 6 jours = 4 juillet sans férié ; avec le 30 juin férié, 6 jours = 6 juillet (lundi).
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 6, ["2026-06-30"]))).toBe("2026-07-06");
  });
  it("férié LE jour de début → non compté, la fin ne tombe jamais sur un férié", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-30"), 1, ["2026-06-30"]))).toBe("2026-07-01");
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 2, ["2026-06-30"]))).toBe("2026-07-01");
  });
  it("0 jour, jour négatif ou non entier → null", () => {
    expect(finApresJoursOuvrables(d("2026-06-29"), 0)).toBeNull();
    expect(finApresJoursOuvrables(d("2026-06-29"), -3)).toBeNull();
    expect(finApresJoursOuvrables(d("2026-06-29"), 1.5)).toBeNull();
  });
  it("aller-retour : compter(début, fin(début, n)) === n, sur 200 tirages avec fériés", () => {
    const feries = ["2026-06-30", "2026-08-01", "2026-12-25", "2027-01-01"];
    let graine = 42;
    const alea = (max: number) => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % max; };
    for (let i = 0; i < 200; i++) {
      const debut = new Date(Date.UTC(2026, alea(12), 1 + alea(28)));
      const n = 1 + alea(40);
      const fin = finApresJoursOuvrables(debut, n, feries)!;
      expect(compterJoursOuvrables(debut, fin, feries), `${iso(debut)} + ${n} j`).toBe(n);
    }
  });
});
