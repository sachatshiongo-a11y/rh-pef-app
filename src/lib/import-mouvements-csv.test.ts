import { describe, expect, it } from "vitest";
import { parserMouvementsCsv, parseNombre, parseDateFr } from "./import-mouvements-csv";
import { grouperParMois } from "./dates-fr";

describe("parseNombre / parseDateFr", () => {
  it("nombres FR", () => {
    expect(parseNombre("2,41")).toBeCloseTo(2.41);
    expect(parseNombre("1 234,56")).toBeCloseTo(1234.56);
    expect(parseNombre("")).toBe(0);
    expect(parseNombre("48")).toBe(48);
  });
  it("dates", () => {
    expect(parseDateFr("06/07/2026")).toBe("2026-07-06");
    expect(parseDateFr("2026-7-6")).toBe("2026-07-06");
    expect(parseDateFr("x")).toBeNull();
  });
});

describe("parserMouvementsCsv — fichier à deux tableaux (inventaire + mouvements)", () => {
  const csv = [
    ",,,,,,,,,,,,Valeur totale du stock en USD,\"5 490,08\",,,,,,,,,",
    "Code article,Désignation,Unité,Catégorie,Fournisseur,Stock inital,Stock minimum,Entrée,Sortie,Alerte stock,Stock final,Prix unitaire en USD,Valeur du stock en USD,Article endommagé,,,Date,Code article,Désignation,Unité,Catégorie,Entrées,Sorties",
    "3,Carré d'agneau,Kg,Viande,ZURAFA,6,5,0,2,Approvisionnement,4,\"48,06\",\"200,41\",,,,06/07/2026,3,Carré d'agneau,Kg,Viande,,2",
    "62,Muscade moulu,,Épices,,,1,1,1,Urgent,0,,,,,,06/07/2026,62,Muscade moulu,,Épices,1,1",
    "94,Tomates pêlées,Pièce,Autres,,,,48,0,Satisfaisant,48,\"1,34\",\"64,42\",,,,08/07/2026,94,Tomates pêlées,Pièce,Autres,48,",
  ].join("\n");

  it("détecte les colonnes du tableau des mouvements (après la colonne Date)", () => {
    const { lignes, erreurs, colonnes } = parserMouvementsCsv(csv);
    expect(erreurs).toEqual([]);
    // Les colonnes du tableau de DROITE (mouvements), pas celles de l'inventaire de gauche.
    expect(colonnes!.date).toBe(16);
    expect(colonnes!.designation).toBe(18);
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toMatchObject({ code: "3", designation: "Carré d'agneau", date: "2026-07-06", entree: 0, sortie: 2 });
    expect(lignes[1]).toMatchObject({ code: "62", entree: 1, sortie: 1 });
    expect(lignes[2]).toMatchObject({ code: "94", designation: "Tomates pêlées", entree: 48, sortie: 0 });
  });
});

describe("grouperParMois — accordéons par mois (ordre conservé)", () => {
  it("groupe et titre par mois, en gardant l'ordre d'entrée (récent → ancien)", () => {
    const items = [
      { id: "a", d: "2026-07-10" },
      { id: "b", d: "2026-07-02" },
      { id: "c", d: "2026-06-28" },
      { id: "d", d: null },
    ];
    const g = grouperParMois(items, (x) => x.d);
    expect(g.map((x) => x.titre)).toEqual(["Juillet 2026", "Juin 2026", "Sans date"]);
    expect(g[0].items.map((x) => x.id)).toEqual(["a", "b"]);
    expect(g[1].items.map((x) => x.id)).toEqual(["c"]);
    expect(g[2].items.map((x) => x.id)).toEqual(["d"]);
  });
});
