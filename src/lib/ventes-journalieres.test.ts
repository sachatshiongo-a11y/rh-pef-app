import { describe, it, expect } from "vitest";
import { avecDimanche, cleCase, cleFiche, lignesDuRapport, lireCleLigne, lireQuantiteVendue, SANS_RUBRIQUE, type FicheVendue } from "./ventes-journalieres";

// Lignes du « Rapport journalier cuisine et bar » (ventes) : des UNITÉS DE VENTE (fiches PLAT et
// BAR), jamais des articles ; dans l'ordre du classeur quand l'import l'a posé.

const fiche = (id: string, nom: string, categorie: string | null, type: "PLAT" | "BAR" = "PLAT", extra: Partial<FicheVendue> = {}): FicheVendue =>
  ({ id, nom, categorie, type, actif: true, ...extra });

describe("lignes de la feuille Cuisine", () => {
  it("fiches PLAT seulement ; sans import : rubriques dans l'ordre du classeur (sans accents ni casse), inconnues après, « Sans rubrique » en dernier ; plats par nom", () => {
    const l = lignesDuRapport("CUISINE", [
      fiche("1", "Moelleux au chocolat", "Desserts"),
      fiche("2", "Carbonara", "Pâtes classiques"),
      fiche("3", "Arrabbiata", "Pâtes classiques"),
      fiche("4", "Plat du chef", null),
      fiche("5", "Salade farfalle façon césar", "ENTREES FROIDES "),
      fiche("6", "Mojito", "Cocktail", "BAR"), // fiche Bar : pas sur la feuille Cuisine
      fiche("7", "Brochette", "Grillades"), // rubrique inconnue du classeur
      fiche("8", "Crème brûlée", "Desserts", "PLAT", { actif: false }),
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
    expect(l.find((x) => x.designation === "Crème brûlée")!.inactif).toBe(true);
    expect(l[0]!.cle).toBe("fiche:5");
  });

  it("après import : l'ORDRE et les LIBELLÉS du classeur ; les fiches hors classeur suivent dans leur rubrique", () => {
    const l = lignesDuRapport("CUISINE", [
      fiche("a", "4 fromages", "Pâtes classiques", "PLAT", { libelleVente: "aux quatre fromages", ordreVente: 11 }),
      fiche("b", "Arrabbiata", "Pâtes classiques", "PLAT", { libelleVente: "Arrabbiata", ordreVente: 9 }),
      fiche("c", "Bolognaise", "Pâtes classiques", "PLAT", { libelleVente: "Bolognaise", ordreVente: 12 }),
      fiche("d", "Anchois du chef", "Pâtes classiques"), // créée à la main : après les lignes du classeur
      fiche("e", "Duo de capitaine", "Entrées froides", "PLAT", { libelleVente: "Duo de capitaine et saumon fumé", ordreVente: 1 }),
      fiche("f", "Crème brûlée", "Desserts", "PLAT", { ordreVente: 45 }),
    ]);
    expect(l.map((x) => x.designation)).toEqual([
      "Duo de capitaine et saumon fumé", "Arrabbiata", "aux quatre fromages", "Bolognaise", "Anchois du chef", "Crème brûlée",
    ]);
  });
});

describe("lignes de la feuille Bar", () => {
  it("fiches BAR seulement (unités de vente) ; sous-rubrique « Vin rouge — Français » juste après « Vin rouge »", () => {
    const l = lignesDuRapport("BAR", [
      fiche("m", "Mojito", "Cocktail", "BAR"),
      fiche("v", "Vin rouge maison — Verre", "Vin rouge — Français", "BAR"),
      fiche("c", "Coca", "Limonade et autre", "BAR"),
      fiche("k", "Kir royal", "apéritif", "BAR"),
      fiche("s", "Spritz", "Apéritif", "BAR"),
      fiche("p", "Carbonara", "Pâtes classiques"),
      fiche("w", "Whisky coca", "Whisky", "BAR"),
    ]);
    expect(l.map((x) => [x.rubrique, x.designation])).toEqual([
      ["Limonade et autre", "Coca"],
      ["apéritif", "Kir royal"],
      ["apéritif", "Spritz"], // « Apéritif » = « apéritif » : une seule rubrique
      ["Vin rouge — Français", "Vin rouge maison — Verre"],
      ["Whisky", "Whisky coca"],
      ["Cocktail", "Mojito"],
    ]);
    expect(l.every((x) => x.espace === "BAR" && x.cle.startsWith("fiche:"))).toBe(true);
  });
});

describe("clés, dimanche, saisie", () => {
  it("clé de ligne : une fiche, rien d'autre", () => {
    expect(lireCleLigne(cleFiche("abc"))).toEqual({ type: "fiche", id: "abc" });
    for (const k of ["", "fiche:", "resto:x1", "article:abc", "abc", "legume:Ail"]) expect(lireCleLigne(k), k).toBeNull();
    expect(cleCase("fiche:a", "2026-09-21")).toBe("fiche:a_2026-09-21");
  });

  it("le dimanche s'affiche s'il porte une vente (0 compris) ou sur demande", () => {
    const jours = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
    expect(avecDimanche(jours, new Map([["fiche:a_2026-09-26", 3]]))).toBe(false);
    expect(avecDimanche(jours, new Map([["fiche:a_2026-09-27", 0]]))).toBe(true);
    expect(avecDimanche(jours, { "fiche:b_2026-09-27": 2 })).toBe(true);
    expect(avecDimanche(jours, {}, true)).toBe(true);
  });

  it("quantité vendue : entier ≥ 0 ; null = saisie retirée ; le reste est refusé en clair", () => {
    expect(lireQuantiteVendue(0)).toEqual({ ok: true, valeur: 0 });
    expect(lireQuantiteVendue(12)).toEqual({ ok: true, valeur: 12 });
    expect(lireQuantiteVendue(null)).toEqual({ ok: true, valeur: null });
    for (const q of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "3", 100_001]) expect(lireQuantiteVendue(q).ok, String(q)).toBe(false);
  });
});
