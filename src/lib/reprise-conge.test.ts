import { describe, it, expect } from "vitest";
import { dateRepriseConge } from "./reprise-conge";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("date de reprise après un congé = prochain jour ouvrable", () => {
  it("fin un vendredi : reprise le samedi (jour ouvrable en RDC)", () => {
    expect(iso(dateRepriseConge(d("2026-09-18")))).toBe("2026-09-19");
  });
  it("fin un samedi : reprise le lundi, jamais le dimanche", () => {
    expect(iso(dateRepriseConge(d("2026-09-19")))).toBe("2026-09-21");
  });
  it("fin la veille d'un férié : le férié est sauté", () => {
    expect(iso(dateRepriseConge(d("2026-09-17"), ["2026-09-18"]))).toBe("2026-09-19");
  });
  it("samedi de fin + lundi férié : reprise le mardi", () => {
    expect(iso(dateRepriseConge(d("2026-09-19"), [d("2026-09-21")]))).toBe("2026-09-22");
  });
});
