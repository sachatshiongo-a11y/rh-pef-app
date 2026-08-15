import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import {
  analyserClasseur,
  distanceChaine,
  planifierFichesSeules,
  simulerCoutsFichesSeules,
  type ArticleCatalogue,
} from "./import-fiches-plats";
import { BOLOGNAISE, feuille, LISTE_ARTICLES, SAUCE_BOLOGNAISE } from "./_fixture-classeur-fiches";

/**
 * Tests PURS du mode `--fiches-seules` : aucune base, aucune connexion. Ils portent sur la
 * DÉCISION (quelles fiches sont créables, lesquelles sont refusées et pourquoi, quels articles
 * manquent et dans quel ordre), que le test d'intégration se contente ensuite d'exécuter.
 *
 * Le catalogue est ici celui de la BASE CIBLE — délibérément différent de la liste d'articles du
 * classeur : c'est tout l'objet du mode. Le classeur ne sert qu'à décrire les fiches.
 */

/** Catalogue cible « idéal » : tous les articles consommés par le classeur synthétique. */
const CATALOGUE_COMPLET: ArticleCatalogue[] = [
  { id: "a1", designation: "20 PENNE RIGATE LM CHEF 12 X 1KG", unite: "Kg", prixUnitaireUSD: new Decimal("0.35") },
  { id: "a2", designation: "LAIT ELLE & VIRE ENTIER RED 1LTR", unite: "L", prixUnitaireUSD: new Decimal("2.5") },
  { id: "a3", designation: "Viande Hachée", unite: "Kg", prixUnitaireUSD: new Decimal("8.07") },
  { id: "a4", designation: "Tomates pêlées 240g", unite: "Pièce", prixUnitaireUSD: new Decimal("1.34") },
  { id: "a5", designation: "Tomates concentrées", unite: "Pièce", prixUnitaireUSD: new Decimal("0.21") },
  { id: "a6", designation: "Vin rouge", unite: "Bouteille", prixUnitaireUSD: new Decimal("9") },
  { id: "a7", designation: "Huile 1L régina", unite: "L", prixUnitaireUSD: new Decimal("2.492") },
  { id: "a8", designation: "Carottes", unite: "kg", prixUnitaireUSD: new Decimal("4.58") },
];

const sans = (...designations: string[]) =>
  CATALOGUE_COMPLET.filter((a) => !designations.includes(a.designation));

const res = () => analyserClasseur({
  SheetNames: ["Sauce bolognaise", "Bolognaise", "Liste des articles"],
  Sheets: { "Sauce bolognaise": SAUCE_BOLOGNAISE, Bolognaise: BOLOGNAISE, "Liste des articles": LISTE_ARTICLES },
});

describe("planifierFichesSeules — quelles fiches sont créables", () => {
  it("catalogue complet : toutes les fiches sont créables, sous-recettes en tête", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET);
    expect(plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(plan.refusees).toEqual([]);
    expect(plan.articlesManquants).toEqual([]);
  });

  it("le rattachement se fait sur le CATALOGUE CIBLE, pas sur la liste d'articles du classeur", () => {
    // Le classeur donne les pennes à 0,35 $ ; la base, elle, les a corrigées à 3,50 $. C'est la
    // base qui doit servir — le mode fiches seules ne réimporte JAMAIS un prix du classeur.
    const catalogue = CATALOGUE_COMPLET.map((a) =>
      a.designation.startsWith("20 PENNE") ? { ...a, prixUnitaireUSD: new Decimal("3.5") } : a,
    );
    const plan = planifierFichesSeules(res(), catalogue);
    const ligne = plan.lignes.find((l) => l.ingredient.designation.startsWith("20 PENNE"))!;
    expect(ligne.rattachement.type).toBe("ARTICLE");
    expect(
      ligne.rattachement.type === "ARTICLE" ? ligne.rattachement.article.prixUnitaireUSD?.toString() : null,
    ).toBe("3.5");
  });

  it("un article introuvable fait refuser SA fiche, nommément", () => {
    const plan = planifierFichesSeules(res(), sans("20 PENNE RIGATE LM CHEF 12 X 1KG"));
    expect(plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise"]);
    expect(plan.refusees).toEqual([
      {
        nom: "Bolognaise",
        onglet: "Bolognaise",
        articlesManquants: ["20 PENNE RIGATE LM CHEF 12 X 1KG"],
        sousRecettesRefusees: [],
      },
    ]);
  });

  it("une sous-recette refusée fait refuser, EN CASCADE, les fiches qui la citent", () => {
    // « Carottes » n'appartient qu'à la sous-recette. « Bolognaise » a pourtant tous SES articles.
    const plan = planifierFichesSeules(res(), sans("Carottes"));
    expect(plan.creables).toEqual([]);
    expect(plan.refusees.map((f) => f.nom).sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    const bolo = plan.refusees.find((f) => f.nom === "Bolognaise")!;
    expect(bolo.articlesManquants).toEqual([]); // ses propres articles sont bien là
    expect(bolo.sousRecettesRefusees).toEqual(["Sauce bolognaise"]);
  });

  it("deux articles du catalogue de même désignation normalisée : signalés, jamais fusionnés en silence", () => {
    const plan = planifierFichesSeules(res(), [
      ...CATALOGUE_COMPLET,
      { id: "z9", designation: "carottes", unite: "kg", prixUnitaireUSD: new Decimal("99") },
    ]);
    expect(plan.ambiguitesCatalogue).toHaveLength(1);
    expect(plan.ambiguitesCatalogue[0]!.cle).toBe("carottes");
    expect(plan.ambiguitesCatalogue[0]!.designations.sort()).toEqual(["Carottes", "carottes"]);
    expect(plan.creables).toHaveLength(2); // l'ambiguïté ne bloque pas, elle se dit

    // Le rattachement est DÉTERMINISTE (tri désignation puis id) : deux exécutions de suite
    // choisissent le même article, jamais l'un puis l'autre.
    const choisi = () => {
      const p = planifierFichesSeules(res(), [
        { id: "z9", designation: "carottes", unite: "kg", prixUnitaireUSD: new Decimal("99") },
        ...CATALOGUE_COMPLET,
      ]);
      const l = p.lignes.find((x) => x.ingredient.cle === "carottes")!;
      return l.rattachement.type === "ARTICLE" ? l.rattachement.article.id : null;
    };
    expect(choisi()).toBe(choisi());
  });
});

describe("liste de travail des articles manquants", () => {
  /** Troisième fiche, qui consomme « Carottes » elle aussi : de quoi trier par usage. */
  const POULET = feuille({
    B9: "FICHE TECHNIQUE",
    B11: "Volailles",
    B13: "Poulet aux carottes",
    B15: "Nombre de portions :", C15: 4,
    B20: "Article", C20: "Unité", D20: "Unités nécessaires",
    B21: "Carottes", C21: "kg", D21: 0.5,
    B22: "Vin rouge", C22: "Bouteille", D22: 1,
    B25: "Total prix de revient HT", F25: 0,
  });

  const resTrois = () => analyserClasseur({
    SheetNames: ["Sauce bolognaise", "Bolognaise", "Poulet aux carottes", "Liste des articles"],
    Sheets: {
      "Sauce bolognaise": SAUCE_BOLOGNAISE,
      Bolognaise: BOLOGNAISE,
      "Poulet aux carottes": POULET,
      "Liste des articles": LISTE_ARTICLES,
    },
  } as XLSX.WorkBook);

  it("dédoublonne et trie DU PLUS UTILISÉ AU MOINS UTILISÉ", () => {
    const plan = planifierFichesSeules(resTrois(), sans("Carottes", "Vin rouge"));
    // « Carottes » : 2 lignes (sauce + poulet). « Vin rouge » : 2 lignes aussi… donc on départage
    // à la désignation. Un article n'apparaît qu'UNE fois, avec le compte de ses occurrences.
    expect(plan.articlesManquants.map((a) => [a.designation, a.occurrences])).toEqual([
      ["Carottes", 2],
      ["Vin rouge", 2],
    ]);
    expect(plan.articlesManquants[0]!.fiches).toEqual(["Sauce bolognaise", "Poulet aux carottes"]);
  });

  it("le plus utilisé passe devant, quel que soit l'ordre alphabétique", () => {
    const plan = planifierFichesSeules(resTrois(), sans("Carottes", "Tomates concentrées"));
    expect(plan.articlesManquants.map((a) => a.designation)).toEqual(["Carottes", "Tomates concentrées"]);
    expect(plan.articlesManquants.map((a) => a.occurrences)).toEqual([2, 1]);
  });
});

describe("sosies — une SUGGESTION à vérifier, jamais une décision", () => {
  it("propose l'article le plus proche quand il en existe un", () => {
    const catalogue = [...sans("Carottes"), { id: "x1", designation: "Carotte", unite: "kg", prixUnitaireUSD: new Decimal("4.5") }];
    const plan = planifierFichesSeules(res(), catalogue);
    const manquant = plan.articlesManquants.find((a) => a.designation === "Carottes")!;
    expect(manquant.sosie?.designation).toBe("Carotte");
    expect(manquant.sosie?.distance).toBe(1);
    expect(manquant.sosie?.conditionnementDifferent).toBe(false);
    // La suggestion ne rattache RIEN : la fiche reste refusée tant qu'un humain n'a pas tranché.
    expect(plan.creables).toEqual([]);
  });

  it("« Huile 1L régina » et « Huile 5L régina » : un caractère d'écart, DEUX conditionnements", () => {
    const catalogue = [
      ...sans("Huile 1L régina"),
      { id: "x2", designation: "Huile 5L régina", unite: "L", prixUnitaireUSD: new Decimal("11") },
    ];
    const plan = planifierFichesSeules(res(), catalogue);
    const manquant = plan.articlesManquants.find((a) => a.designation === "Huile 1L régina")!;
    expect(manquant.sosie?.designation).toBe("Huile 5L régina");
    expect(manquant.sosie?.distance).toBe(1);
    expect(manquant.sosie?.conditionnementDifferent).toBe(true); // 1 L ≠ 5 L : pas le même article
  });

  it("un préfixe de code ne change pas le conditionnement (le sosie reste proposable sans alerte)", () => {
    // Cas réel : « 15 SPAGHETTI LM CHEF 12 X 1KG » (classeur) contre « Spaghetti Lm Chef 12 X 1KG »
    // (base). Même conditionnement (1 kg) : c'est très probablement le même article — à confirmer.
    const SPAGHETTI = feuille({
      B9: "FICHE TECHNIQUE",
      B13: "Spaghetti nature",
      B15: "Nombre de portions :", C15: 1,
      B20: "Article", C20: "Unité", D20: "Unités nécessaires",
      B21: "15 SPAGHETTI LM CHEF 12 X 1KG", C21: "Kg", D21: 0.2,
      B24: "Total prix de revient HT", F24: 0,
    });
    const r = analyserClasseur({
      SheetNames: ["Spaghetti nature", "Liste des articles"],
      Sheets: { "Spaghetti nature": SPAGHETTI, "Liste des articles": LISTE_ARTICLES },
    } as XLSX.WorkBook);
    const plan = planifierFichesSeules(r, [
      { id: "s1", designation: "Spaghetti Lm Chef 12 X 1KG", unite: "Kg", prixUnitaireUSD: new Decimal("1.2") },
    ]);
    const manquant = plan.articlesManquants[0]!;
    expect(manquant.sosie?.designation).toBe("Spaghetti Lm Chef 12 X 1KG");
    expect(manquant.sosie?.conditionnementDifferent).toBe(false);
    expect(plan.creables).toEqual([]); // suggéré, PAS rattaché
  });

  it("ne propose rien quand rien ne ressemble", () => {
    const catalogue = [...sans("Carottes"), { id: "x3", designation: "Papier aluminium", unite: "Rouleau", prixUnitaireUSD: new Decimal("3") }];
    const plan = planifierFichesSeules(res(), catalogue);
    expect(plan.articlesManquants.find((a) => a.designation === "Carottes")!.sosie).toBeNull();
  });

  it("distanceChaine reste une distance de Levenshtein ordinaire", () => {
    expect(distanceChaine("carottes", "carottes")).toBe(0);
    expect(distanceChaine("carottes", "carotte")).toBe(1);
    expect(distanceChaine("", "abc")).toBe(3);
    expect(distanceChaine("abc", "")).toBe(3);
    expect(distanceChaine("chat", "chien")).toBe(3);
  });
});

describe("coût des fiches créables, chiffré par le VRAI moteur sur le catalogue cible", () => {
  it("catalogue complet et prix renseignés : coût complet", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET);
    const couts = simulerCoutsFichesSeules(plan);
    expect(couts.map((c) => c.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(couts.every((c) => !c.incomplet)).toBe(true);
  });

  it("un article du catalogue SANS prix sort en coût partiel, avec le motif", () => {
    const catalogue = CATALOGUE_COMPLET.map((a) =>
      a.designation === "Carottes" ? { ...a, prixUnitaireUSD: null } : a,
    );
    const plan = planifierFichesSeules(res(), catalogue);
    const sauce = simulerCoutsFichesSeules(plan).find((c) => c.nom === "Sauce bolognaise")!;
    expect(sauce.incomplet).toBe(true);
    expect(sauce.motifs.join(" ")).toContain("Carottes");
    // La fiche est tout de même CRÉÉE : l'ingrédient existe et sera visible à l'écran, seul son
    // prix manque — c'est le cas que l'application sait annoncer (« coût incomplet »).
    expect(plan.creables.map((f) => f.nom)).toContain("Sauce bolognaise");
  });

  it("le coût suit le prix DE LA BASE et non celui du classeur", () => {
    const cher = CATALOGUE_COMPLET.map((a) =>
      a.designation.startsWith("20 PENNE") ? { ...a, prixUnitaireUSD: new Decimal("3.5") } : a,
    );
    const auClasseur = simulerCoutsFichesSeules(planifierFichesSeules(res(), CATALOGUE_COMPLET))
      .find((c) => c.nom === "Bolognaise")!;
    const enBase = simulerCoutsFichesSeules(planifierFichesSeules(res(), cher))
      .find((c) => c.nom === "Bolognaise")!;
    expect(new Decimal(enBase.coutParPortion!).greaterThan(auClasseur.coutParPortion!)).toBe(true);
  });
});
