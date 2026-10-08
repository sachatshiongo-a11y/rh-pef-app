import { describe, it, expect } from "vitest";
import { bornesGroupe } from "./groupes-periode";

const iso = (d: Date) => d.toISOString().slice(0, 10);
describe("bornesGroupe", () => {
  it("jour", () => {
    const b = bornesGroupe("jour", new Date("2026-10-08T13:45:00Z"));
    expect([iso(b.gte), iso(b.lt)]).toEqual(["2026-10-08", "2026-10-09"]);
  });
  it("semaine : du lundi au lundi suivant (un dimanche appartient à la semaine qui finit)", () => {
    const b = bornesGroupe("semaine", new Date("2026-10-11T00:00:00Z")); // dimanche
    expect([iso(b.gte), iso(b.lt)]).toEqual(["2026-10-05", "2026-10-12"]);
    const c = bornesGroupe("semaine", new Date("2026-10-05T00:00:00Z")); // lundi
    expect([iso(c.gte), iso(c.lt)]).toEqual(["2026-10-05", "2026-10-12"]);
  });
  it("mois : passage d'année compris", () => {
    const b = bornesGroupe("mois", new Date("2026-12-31T00:00:00Z"));
    expect([iso(b.gte), iso(b.lt)]).toEqual(["2026-12-01", "2027-01-01"]);
  });
});
