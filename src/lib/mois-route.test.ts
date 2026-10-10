import { describe, it, expect } from "vitest";
import { lireMoisAnnee } from "./mois-route";

const repli = { mois: 10, annee: 2026 };
const q = (s: string) => new URLSearchParams(s);

describe("?mois=&annee= des routes d'export", () => {
  it("absents : le mois courant de la paie", () => {
    expect(lireMoisAnnee(q(""), repli)).toEqual({ ok: true, mois: 10, annee: 2026 });
  });
  it("présents : le mois demandé (mois clôturé)", () => {
    expect(lireMoisAnnee(q("mois=8&annee=2026"), repli)).toEqual({ ok: true, mois: 8, annee: 2026 });
  });
  it("illisibles ou incomplets : refusés, jamais remplacés en silence par le mois courant", () => {
    for (const s of ["mois=13&annee=2026", "mois=0&annee=2026", "mois=abc&annee=2026", "mois=8", "annee=2026", "mois=8&annee=26", "mois=8.5&annee=2026"]) {
      expect(lireMoisAnnee(q(s), repli).ok, s).toBe(false);
    }
  });
});
