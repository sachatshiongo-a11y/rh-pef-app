import { describe, it, expect } from "vitest";
import {
  avecDimanche, cleCase, cleFiche, cleResto, lignesDuRapport, lireCleLigne, lireQuantiteVendue, SANS_RUBRIQUE,
  type BoissonBar, type FicheVendue,
} from "./ventes-journalieres";

// Lignes du « Rapport journalier cuisine et bar » (ventes) : d'où elles viennent, dans quel ordre.

const fiche = (id: string, nom: string, categorie: string | null, type: "PLAT" | "BAR" = "PLAT", actif = true): FicheVendue => ({ id, nom, categorie, type, actif });
const boisson = (id: string, designation: string, categorie: string | null, ordre: number, unite: string | null = null, actif = true): BoissonBar => ({ id, designation, unite, categorie, ordre, actif });

describe("lignes de la feuille Cuisine", () => {
  it("fiches PLAT seulement ; rubriques dans l'ordre du classeur (sans accents ni casse), inconnues après, « Sans rubrique » en dernier ; plats par nom", () => {
    const l = lignesDuRapport("CUISINE", [
      fiche("1", "Moelleux au chocolat", "Desserts"),
      fiche("2", "Carbonara", "Pâtes classiques"),
      fiche("3", "Arrabbiata", "Pâtes classiques"),
      fiche("4", "Plat du chef", null),
      fiche("5", "Salade farfalle façon césar", "ENTREES FROIDES "),
      fiche("6", "Mojito", "Cocktail", "BAR"), // fiche Bar : pas sur la feuille Cuisine
      fiche("7", "Brochette", "Grillades"), // rubrique inconnue du classeur
      fiche("8", "Crème brûlée", "Desserts", "PLAT", false),
    ]);
    expect(l.map((x) => [x.rubrique, x.designation])).toEqual([
      ["ENTREES FROIDES", "Salade farfalle façon césar"],
      ["Pâtes classiques", "Arrabbiata"],
      ["Pâtes classiques", "Carbonara"],
      ["Desserts", "Crème brûlée"],
      ["Desserts", "Moelleux au chocolat"],
      ["Grillades", "Brochette"],
      [SANS_RUBRIQUE, "Plat du chef"],
    ]);
    expect(l.every((x) => x.espace === "CUISINE")).toBe(true);
    expect(l.find((x) => x.designation === "Crème brûlée")!.inactif).toBe(true);
    expect(l[0]!.cle).toBe("fiche:5");
  });

  it("les boissons ne vont jamais sur la feuille Cuisine", () => {
    expect(lignesDuRapport("CUISINE", [], [boisson("c", "Coca Cola", "Limonade et autre", 9)])).toEqual([]);
  });
});

describe("lignes de la feuille Bar", () => {
  it("articles du bar dans l'ordre de l'écran Stock restaurant, puis fiches Bar dans la même rubrique (casse près) ou après", () => {
    const l = lignesDuRapport(
      "BAR",
      [fiche("m", "Mojito", "Cocktail", "BAR"), fiche("k", "Kir royal", "apéritif", "BAR"), fiche("p", "Carbonara", "Pâtes classiques")],
      [
        boisson("coca", "Coca Cola", "Limonade et autre", 9),
        boisson("eau", "Acqua Panna", "Eau plate et petillante", 1, "Bouteille"),
        boisson("camp", "Campari", "Apéritif", 48),
        boisson("fanta", "Fanta", "Limonade et autre", 11, null, false),
        boisson("glace", "Glaçons", null, 12),
      ],
    );
    expect(l.map((x) => [x.rubrique, x.designation])).toEqual([
      ["Eau plate et petillante", "Acqua Panna (Bouteille)"],
      ["Limonade et autre", "Coca Cola"],
      ["Limonade et autre", "Fanta"],
      ["Apéritif", "Campari"],
      ["Apéritif", "Kir royal"], // « apéritif » de la fiche = « Apéritif » des articles
      ["Cocktail", "Mojito"],
      [SANS_RUBRIQUE, "Glaçons"],
    ]);
    expect(l.map((x) => x.cle)).toContain("resto:coca");
    expect(l.map((x) => x.cle)).toContain("fiche:m");
    expect(l.find((x) => x.designation === "Fanta")!.inactif).toBe(true);
  });
});

describe("clés, dimanche, saisie", () => {
  it("clé de ligne : fiche ou article du bar, rien d'autre", () => {
    expect(lireCleLigne(cleFiche("abc"))).toEqual({ type: "fiche", id: "abc" });
    expect(lireCleLigne(cleResto("x1"))).toEqual({ type: "resto", id: "x1" });
    for (const k of ["", "fiche:", "resto:", "article:abc", "abc", "legume:Ail"]) expect(lireCleLigne(k), k).toBeNull();
    expect(cleCase("fiche:a", "2026-09-21")).toBe("fiche:a_2026-09-21");
  });

  it("le dimanche s'affiche s'il porte une vente (0 compris) ou sur demande", () => {
    const jours = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
    expect(avecDimanche(jours, new Map([["fiche:a_2026-09-26", 3]]))).toBe(false);
    expect(avecDimanche(jours, new Map([["fiche:a_2026-09-27", 0]]))).toBe(true);
    expect(avecDimanche(jours, { "resto:b_2026-09-27": 2 })).toBe(true);
    expect(avecDimanche(jours, {}, true)).toBe(true);
  });

  it("quantité vendue : entier ≥ 0 ; null = saisie retirée ; le reste est refusé en clair", () => {
    expect(lireQuantiteVendue(0)).toEqual({ ok: true, valeur: 0 });
    expect(lireQuantiteVendue(12)).toEqual({ ok: true, valeur: 12 });
    expect(lireQuantiteVendue(null)).toEqual({ ok: true, valeur: null });
    for (const q of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "3", 100_001]) expect(lireQuantiteVendue(q).ok, String(q)).toBe(false);
  });
});
