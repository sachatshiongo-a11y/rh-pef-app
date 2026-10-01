import { describe, it, expect } from "vitest";
import { lireNombreSaisi, versSaisie, decSaisi, decSaisiOptionnel, conseilSaisie, dec, decOptionnel } from "./nombre";

// Règle commune aux trois applications (Sacha, 2026-10-01) : la VIRGULE est la seule décimale ;
// le POINT et l'ESPACE séparent les milliers. « 1.5 » est illisible (« écrivez 1,5 »).
describe("lecture commune des nombres saisis", () => {
  it.each([["1,5", 1.5], ["150.000", 150000], ["150 000", 150000], ["1.500,5", 1500.5], ["2350", 2350], [",5", 0.5]])("« %s » vaut %s", (s, v) => {
    expect(lireNombreSaisi(s)).toBe(v);
  });
  it.each([["1.5"], ["0.125"], ["abc"], ["15.00,5"], [""]])("« %s » → null", (s) => {
    expect(lireNombreSaisi(s)).toBeNull();
  });
  it("versSaisie se relit à l'identique", () => {
    for (const n of [1.5, 2.125, 150000, 0.0001]) expect(lireNombreSaisi(versSaisie(n))).toBe(n);
  });
  it("serveur : vide → 0 / null, illisible → erreur qui conseille", () => {
    expect(decSaisi("")).toBe(0);
    expect(decSaisiOptionnel(" ")).toBeNull();
    expect(dec("2.350")).toBe(2350); // le taux de change écrit avec un point de milliers
    expect(decOptionnel("1,5")).toBe(1.5);
    expect(() => decSaisi("2.5", "Heures")).toThrow("« 2.5 » illisible (Heures) : écrivez 2,5 — la virgule est la décimale");
    expect(() => dec("abc")).toThrow("illisible");
    expect(conseilSaisie("1.5")).toBe("écrivez 1,5");
    expect(conseilSaisie("1.500")).toBeNull();
  });
});
