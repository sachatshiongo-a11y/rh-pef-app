import { describe, it, expect } from "vitest";
import { detailConso, mentionSansPrix, sommeValeurs } from "./valeur-stock";

describe("valeurs de stock incomplètes — annoncées, jamais complétées par un zéro", () => {
  it("sommeValeurs ne compte pas null comme 0 : il le dénombre", () => {
    expect(sommeValeurs([2.5, null, 4, undefined])).toEqual({ montant: 6.5, nbValorises: 2, nbSansPrix: 2 });
    expect(sommeValeurs([null, null])).toEqual({ montant: 0, nbValorises: 0, nbSansPrix: 2 });
    expect(sommeValeurs([])).toEqual({ montant: 0, nbValorises: 0, nbSansPrix: 0 });
  });
  it("mentionSansPrix : vide quand rien ne manque", () => {
    expect(mentionSansPrix(0)).toBe("");
    expect(mentionSansPrix(3)).toBe("partiel : 3 sans prix");
  });
  it("detailConso ne compte comme valorisées que les valorisées, et sépare livraisons et pertes", () => {
    const part = (montant: number, nb: number, nbSansPrix = 0) => ({ montant, nb, nbSansPrix });
    const fmt = (n: number) => `${n.toFixed(2)} $`;
    expect(detailConso({ nb: 3, nbSansPrix: 2, livraisons: part(10, 2, 1), pertes: part(1, 1, 1), sansMotif: part(0, 0) }, fmt))
      .toBe("3 sortie(s) valorisée(s) · partiel : 2 sans prix · livraisons restaurant 10.00 $ · pertes 1.00 $");
    expect(detailConso({ nb: 1, nbSansPrix: 0, livraisons: part(0, 0), pertes: part(0, 0), sansMotif: part(4, 1) }, fmt, 2))
      .toBe("1 sortie(s) valorisée(s) · livraisons restaurant 0.00 $ · pertes 0.00 $ · sans motif 4.00 $ · dont 2 en FC non valorisée(s) : taux non défini");
  });
});
