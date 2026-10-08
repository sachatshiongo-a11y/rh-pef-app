import { describe, it, expect } from "vitest";
import { abreviationsShifts } from "./abreviations";

const ab = (noms: string[]) => [...abreviationsShifts(noms.map((nom, i) => ({ id: String(i), nom }))).values()];

describe("abréviations de shifts (vue Mois du Planning)", () => {
  it("courtes quand elles sont distinctes", () => {
    expect(ab(["Matin", "Soir", "Nuit"])).toEqual(["Ma", "So", "Nu"]);
  });
  it("jamais deux shifts avec la même abréviation : on allonge ceux en conflit seulement", () => {
    const r = ab(["Matin", "Maintenance", "Soir"]);
    expect(new Set(r).size).toBe(3);
    expect(r[2]).toBe("So"); // le shift sans conflit reste court
    expect(r[0].length).toBeGreaterThan(2);
  });
  it("noms à plusieurs mots : initiales, puis allongement si elles se confondent", () => {
    expect(ab(["Soirée bar", "Matin"])).toEqual(["SB", "Ma"]);
    const r = ab(["Soirée bar", "Service banquet"]);
    expect(new Set(r).size).toBe(2);
  });
  it("deux shifts de même nom restent distincts de tout autre", () => {
    const r = ab(["Matin", "Matin", "Nuit"]);
    expect(r[2]).toBe("Nu");
  });
});
