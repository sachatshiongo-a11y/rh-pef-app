import { describe, it, expect } from "vitest";
import {
  consommationParArticleCatalogue, consommationsSemaine, ecartJour, lignesComparaison, lignesExportComparaison, lignesExportConso, sortiesParMotif, texteConso,
  SECTION_CONSO, SECTION_LIVRE, SECTION_PERTES, SECTION_SANS_MOTIF,
} from "./journalier-restaurant";
import type { ArticleRestoSR, EntreesStockResto } from "./stock-restaurant";

// Conso. journalière : ce qui sort du dépôt est séparé par motif (livré au restaurant, perte, sans
// motif) ; la consommation réelle vient des comptages du restaurant, « — » sans comptage.

const JOURS = ["2026-09-21", "2026-09-22", "2026-09-23"];
const S = (articleId: string, date: string, quantite: number, categorieSortie: string | null) => ({ articleId, designation: articleId, date, quantite, categorieSortie });

describe("sortiesParMotif", () => {
  it("sépare livré au restaurant, pertes et sorties sans motif, par article et par jour", () => {
    const r = sortiesParMotif([
      S("Farine", "2026-09-21", 2, "LIVRAISON_RESTAURANT"),
      S("Farine", "2026-09-21", 1, "LIVRAISON_RESTAURANT"),
      S("Farine", "2026-09-22", 0.5, "PERTE"),
      S("Beurre", "2026-09-23", 1, null),
      S("Beurre", "2026-09-30", 9, "LIVRAISON_RESTAURANT"), // hors semaine
    ], JOURS);
    expect(r.livraisons).toEqual([{ id: "Farine", designation: "Farine", jours: [3, 0, 0], total: 3 }]);
    expect(r.pertes).toEqual([{ id: "Farine", designation: "Farine", jours: [0, 0.5, 0], total: 0.5 }]);
    expect(r.sansMotif).toEqual([{ id: "Beurre", designation: "Beurre", jours: [0, 0, 1], total: 1 }]);
  });
});

const farine: ArticleRestoSR = { id: "f", designation: "Farine", espace: "CUISINE", unite: "g", articleStockId: "cat-farine", uniteCatalogue: "kg" };
const vin: ArticleRestoSR = { id: "v", designation: "Vin", espace: "BAR", unite: "bouteille", articleStockId: "cat-vin", uniteCatalogue: "bouteille" };
const e: EntreesStockResto = {
  articles: [farine, vin],
  comptages: [
    { articleRestoId: "f", date: "2026-09-20", quantite: "1000" },
    { articleRestoId: "f", date: "2026-09-21", quantite: "1500" },
    { articleRestoId: "f", date: "2026-09-23", quantite: "2500" },
    { articleRestoId: "v", date: "2026-09-10", quantite: "4" },
  ],
  livraisons: [
    { id: "l1", articleStockId: "cat-farine", designation: "Farine", uniteCatalogue: "kg", date: "2026-09-21", quantite: "2", categorieSortie: "LIVRAISON_RESTAURANT" },
    { id: "l2", articleStockId: "cat-farine", designation: "Farine", uniteCatalogue: "kg", date: "2026-09-23", quantite: "2", categorieSortie: "LIVRAISON_RESTAURANT" },
  ],
};

describe("consommation réelle de la semaine", () => {
  it("une ligne par article du restaurant compté dans la semaine, « — » les jours sans comptage", () => {
    const lignes = consommationsSemaine(e, JOURS);
    expect(lignes.map((l) => l.designation)).toEqual(["Farine"]); // le vin n'est pas compté cette semaine
    const [f] = lignes;
    // 21 : 1000 + 2000 − 1500 = 1500 ; 22 : pas de comptage ; 23 : 1500 + 2000 − 2500 = 1000.
    expect(f!.jours.map(texteConso)).toEqual(["1 500", "—", "1 000"]);
    expect(f!.unite).toBe("g");
  });

  it("filtre par espace (Cuisine / Bar)", () => {
    expect(consommationsSemaine(e, JOURS, "BAR")).toEqual([]);
    expect(consommationsSemaine(e, JOURS, "CUISINE").length).toBe(1);
  });

  it("consommation négative : affichée avec son signe et l'écart, jamais masquée", () => {
    const x: EntreesStockResto = { ...e, comptages: [{ articleRestoId: "f", date: "2026-09-20", quantite: "1000" }, { articleRestoId: "f", date: "2026-09-21", quantite: "3500" }] };
    const [f] = consommationsSemaine(x, JOURS);
    expect(f!.jours[0]).toMatchObject({ etat: "CONNUE", negative: true, quantite: "-500" });
    expect(texteConso(f!.jours[0]!)).toBe("-500");
  });

  it("par article du catalogue, dans l'unité du catalogue ; « — » (null) sans comptage", () => {
    const m = consommationParArticleCatalogue(e, JOURS);
    expect(m.get("cat-farine")).toEqual(["1.5", null, "1"]);
    expect(m.get("cat-vin")).toEqual([null, null, null]);
  });
});

describe("écart livré / consommé", () => {
  it("livré non consommé, consommé plus que livré ; aucun écart quand le consommé est inconnu", () => {
    expect(ecartJour(3, "1.5")).toBe("LIVRE_NON_CONSOMME");
    expect(ecartJour(1, "1.5")).toBe("CONSOMME_PLUS_QUE_LIVRE");
    expect(ecartJour(0, "0.2")).toBe("CONSOMME_PLUS_QUE_LIVRE");
    expect(ecartJour(2, "2")).toBeNull();
    expect(ecartJour(2, null)).toBeNull();
  });
});

describe("export de l'onglet Consommation", () => {
  it("sépare livré au restaurant, pertes, sans motif, légumes et consommation réelle (« — » sans comptage)", () => {
    const sorties = sortiesParMotif([
      S("Farine", "2026-09-21", 2, "LIVRAISON_RESTAURANT"), S("Farine", "2026-09-22", 0.5, "PERTE"), S("Beurre", "2026-09-23", 1, null),
    ], JOURS);
    const r = lignesExportConso({ sorties, legumes: [{ nom: "Tomate", jours: [1, 0, 0] }], consoResto: consommationsSemaine(e, JOURS) });
    const titres = r.sectionRows.map((i) => r.lignes[i]![0]);
    expect(titres).toEqual([SECTION_LIVRE, SECTION_PERTES, SECTION_SANS_MOTIF, "Légumes frais (achats du jour)", SECTION_CONSO]);
    const apres = (titre: string) => r.lignes[r.lignes.findIndex((l) => l[0] === titre) + 1]!;
    expect(apres(SECTION_LIVRE)).toEqual(["Farine", "2", "", "", "2"]);
    expect(apres(SECTION_PERTES)).toEqual(["Farine", "", "0,5", "", "0,5"]);
    expect(apres(SECTION_SANS_MOTIF)).toEqual(["Beurre", "", "", "1", "1"]);
    // Consommation : « — » le jour sans comptage, et donc pas de total partiel.
    expect(apres(SECTION_CONSO)).toEqual(["Farine (g)", "1 500", "—", "1 000", "—"]);
    expect(r.rolesLignes[r.lignes.findIndex((l) => l[0] === "Farine (g)")]).toBe("conso");
    expect(r.rolesLignes[r.lignes.findIndex((l) => l[0] === "Farine" )]).toBe("liv");
  });

  it("une consommation négative est marquée « écart » dans l'export", () => {
    const x: EntreesStockResto = { ...e, comptages: [{ articleRestoId: "f", date: "2026-09-20", quantite: "1000" }, { articleRestoId: "f", date: "2026-09-21", quantite: "3500" }] };
    const r = lignesExportConso({ sorties: sortiesParMotif([], JOURS), legumes: [], consoResto: consommationsSemaine(x, JOURS) });
    expect(r.lignes.at(-1)).toEqual(["Farine (g)", "-500 (écart)", "—", "—", "—"]);
  });

  it("total de consommation seulement quand tous les jours sont connus", () => {
    const x: EntreesStockResto = { ...e, comptages: [
      { articleRestoId: "f", date: "2026-09-20", quantite: "1000" }, { articleRestoId: "f", date: "2026-09-21", quantite: "1500" },
      { articleRestoId: "f", date: "2026-09-22", quantite: "1200" }, { articleRestoId: "f", date: "2026-09-23", quantite: "2500" },
    ] };
    const r = lignesExportConso({ sorties: sortiesParMotif([], JOURS), legumes: [], consoResto: consommationsSemaine(x, JOURS) });
    // 1500 + 300 + (1200 + 2000 − 2500 = 700) = 2500.
    expect(r.lignes.at(-1)).toEqual(["Farine (g)", "1 500", "300", "700", "2 500"]);
  });
});

describe("comparaison commandé / livré / consommé", () => {
  const articles = [{ id: "cat-farine", designation: "Farine", categorie: "Épicerie" }, { id: "cat-sel", designation: "Sel", categorie: "Épicerie" }, { id: "cat-riz", designation: "Riz", categorie: "Épicerie" }];

  it("met côte à côte commandé, livré au restaurant (pas les pertes) et consommé, par article du catalogue", () => {
    const sorties = sortiesParMotif([
      { articleId: "cat-farine", designation: "Farine", date: "2026-09-21", quantite: 2, categorieSortie: "LIVRAISON_RESTAURANT" },
      { articleId: "cat-farine", designation: "Farine", date: "2026-09-21", quantite: 5, categorieSortie: "PERTE" },
      { articleId: "cat-farine", designation: "Farine", date: "2026-09-23", quantite: 2, categorieSortie: "LIVRAISON_RESTAURANT" },
    ], JOURS);
    const lignes = lignesComparaison({
      jours: JOURS, articles, commandes: { "cat-farine_2026-09-21": 3, "cat-sel_2026-09-22": 1 },
      livraisons: sorties.livraisons, consoParArticle: consommationParArticleCatalogue(e, JOURS), inclureHorsCatalogue: true,
    });
    expect(lignes.map((l) => l.designation)).toEqual(["Farine", "Sel"]); // le riz n'a rien : absent
    const f = lignes[0]!;
    expect(f.cmd).toEqual([3, 0, 0]);
    expect(f.liv).toEqual([2, 0, 2]);
    expect(f.conso).toEqual(["1.5", null, "1"]);
    expect(f.ecarts).toEqual(["LIVRE_NON_CONSOMME", null, "LIVRE_NON_CONSOMME"]);
    expect(lignes[1]!.conso).toEqual([null, null, null]);
  });

  it("un article sans commande ni livraison mais consommé apparaît (consommé plus que livré)", () => {
    const lignes = lignesComparaison({
      jours: JOURS, articles, commandes: {}, livraisons: [],
      consoParArticle: new Map([["cat-riz", ["0.5", null, null]]]), inclureHorsCatalogue: true,
    });
    expect(lignes.map((l) => [l.designation, l.ecarts[0]])).toEqual([["Riz", "CONSOMME_PLUS_QUE_LIVRE"]]);
  });
});

describe("export de l'onglet Comparaison", () => {
  it("C / L / Cs par jour et au total, « — » pour un consommé inconnu, écarts repérés par cellule", () => {
    const lignes = [
      { id: "a", designation: "Farine", categorie: "Épicerie", lien: true, cmd: [3, 0, 0], liv: [2, 0, 0], conso: ["1.5", "0.25", "0"], ecarts: ["LIVRE_NON_CONSOMME", "CONSOMME_PLUS_QUE_LIVRE", null] as const },
      { id: "b", designation: "Tomate", categorie: "Légumes frais", lien: false, cmd: [1, 0, 0], liv: [1, 0, 0], conso: [null, null, null], ecarts: [null, null, null] as const },
    ].map((l) => ({ ...l, ecarts: [...l.ecarts] }));
    const r = lignesExportComparaison(lignes, ["Lun 21", "Mar 22", "Mer 23"]);
    expect(r.lignes).toEqual([
      ["Épicerie"],
      ["Farine", "3", "2", "1,5", "", "", "0,25", "", "", "0", "3", "2", "1,75"],
      ["Légumes frais"],
      ["Tomate", "1", "1", "—", "", "", "—", "", "", "—", "1", "1", "—"],
    ]);
    expect(r.sectionRows).toEqual([0, 2]);
    expect(r.entete).toEqual(["Article", "Lun 21 Cmd", "Lun 21 Liv", "Lun 21 Conso", "Mar 22 Cmd", "Mar 22 Liv", "Mar 22 Conso", "Mer 23 Cmd", "Mer 23 Liv", "Mer 23 Conso", "Total Cmd", "Total Liv", "Total Conso"]);
    expect(r.colRole.slice(0, 4)).toEqual([null, "cmd", "liv", "conso"]);
    expect([...r.ecarts].sort()).toEqual(["1:3", "1:6"]);
  });
});
