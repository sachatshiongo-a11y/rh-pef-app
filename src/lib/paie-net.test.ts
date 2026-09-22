import { describe, it, expect } from "vitest";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "./paie-net";

// Ligne RÉELLE de la paie de septembre 2026 (Aimée Mutita) : 368,50 versés dont 114,78 de transport.
const aimee = { salNetUSD: 368.5, transportUSD: 114.78 };

describe("paie-net — salaire net = total versé − transport", () => {
  it("salaire net hors transport", () => {
    expect(salaireNetUSD(aimee)).toBeCloseTo(253.72, 2);
  });
  it("total versé = ce qui est remis, transport compris", () => {
    expect(totalVerseUSD(aimee)).toBeCloseTo(368.5, 2);
  });
  it("sans transport, salaire net = total versé", () => {
    expect(salaireNetUSD({ salNetUSD: 164, transportUSD: 0 })).toBe(164);
    expect(totalVerseUSD({ salNetUSD: 164, transportUSD: 0 })).toBe(164);
  });
  it("en CDF, au taux du bulletin", () => {
    expect(salaireNetCDF(aimee, 2800)).toBeCloseTo(253.72 * 2800, 0);
  });
  it("accepte les Decimal de Prisma (objets à toString) et les chaînes", () => {
    const dec = (v: string) => ({ toString: () => v });
    expect(salaireNetUSD({ salNetUSD: dec("368.50"), transportUSD: dec("114.78") })).toBeCloseTo(253.72, 2);
    expect(salaireNetUSD({ salNetUSD: "368.50", transportUSD: "114.78" })).toBeCloseTo(253.72, 2);
  });
  it("un transport supérieur au versé (donnée incohérente) donne un net négatif, jamais NaN", () => {
    expect(salaireNetUSD({ salNetUSD: 10, transportUSD: 25 })).toBe(-15);
  });
});
