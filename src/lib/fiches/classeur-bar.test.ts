import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { calculerCout } from "./cout";
import {
  choixInitiaux, correspondanceFiche, lireClasseurBar, planifierImportBar, rattacherFiches, rattacherIngredients,
  uniteConvertible, validerChoix, validerFichesLues, valeursCreation, formeArticle, memeArticle, scoreProche, contenanceRequise, articleVise, contenanceProposee, erreurContenanceChoisie,
  type ArticleExistant, type ChoixImportBar, type FicheBarLue, type FicheExistanteBar,
} from "./classeur-bar";

/**
 * « Importer les fiches du bar (classeur Excel) » : lecture du classeur de la Direction, règle de
 * correspondance des fiches (jamais devinée), rattachement des ingrédients, et plan PUR partagé par
 * la simulation et l'écriture.
 *
 * FIXTURE : `__fixtures__/fiches-bar.xlsx` est le VRAI classeur de la Direction (« Fiches techniques
 * du bar », reçu le 2026-09-30) débarrassé de ce que l'import ne lit pas — photos, dessins, styles,
 * thème — et dont la feuille « Liste des fournisseurs » est réduite à ses 40 premières rangées
 * (20 Mo → 93 Ko). Les 29 feuilles de fiche sont intactes, octet pour octet.
 */

const FIXTURE = path.join(__dirname, "__fixtures__", "fiches-bar.xlsx");
const ORIGINAL = `${process.env.HOME}/Downloads/Tableurs/Fiches techniques du bar(Récupération automatique).xlsx`;

// ─── Classeur construit (mises en page qui varient) ──────────────────────────

type Cel = string | number | null | { f: string; v: string } | { n: number };
async function classeur(feuilles: Record<string, Cel[][]>, depart = 0): Promise<Uint8Array> {
  const z = new JSZip();
  const partages: string[] = [];
  const idx = (t: string) => { const i = partages.indexOf(t); if (i >= 0) return i; partages.push(t); return partages.length - 1; };
  const noms = Object.keys(feuilles);
  noms.forEach((nom, k) => {
    const rangees = feuilles[nom]!.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => {
      const ref = `${String.fromCharCode(65 + depart + j)}${i + 1}`;
      if (c === null) return "";
      if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
      if (typeof c === "object" && "f" in c) return `<c r="${ref}" t="str"><f>${c.f}</f><v xml:space="preserve">${c.v}</v></c>`;
      if (typeof c === "object") return `<c r="${ref}"><f>A1*2</f><v>${c.n}</v></c>`;
      return `<c r="${ref}" t="s"><v>${idx(c)}</v></c>`;
    }).join("")}</row>`).join("");
    z.file(`xl/worksheets/sheet${k + 1}.xml`, `<worksheet><sheetData>${rangees}</sheetData></worksheet>`);
  });
  z.file("xl/workbook.xml", `<workbook><sheets>${noms.map((n, k) => `<sheet name="${n}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships>${noms.map((_, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}</Relationships>`);
  z.file("xl/sharedStrings.xml", `<sst>${partages.map((t) => `<si><t>${t.replace(/&/g, "&amp;").replace(/'/g, "&apos;")}</t></si>`).join("")}</sst>`);
  return z.generateAsync({ type: "uint8array" });
}

const XL = (v: string) => ({ f: "_xlfn.XLOOKUP(x)", v });
const feuilleType = (type: string, nom: string): Cel[][] => [
  ["FICHE TECHNIQUE"], [], [type], [], [nom], [],
  ["Nombre de verres:", 2], [], ["Prix de vente TTC :", { n: 12.345 }], ["Taux TVA :", 0.16], [],
  ["Mode d'élaboration : "], ["Shaker : "], ["Blender : ", "x"], [],
  ["Type de verre utilisé:", "Verre à cocktail"],
  ["Article", "Unité ", "Unités nécessaires", "Coût d'achat HT à l'unité", "Prix de revient HT"],
  ["Rhum blanc", XL("cl"), 4, { n: 0.2 }, { n: 0.8 }],
  [null, XL(""), 2, { n: 0 }, { n: 0 }], // formule XLOOKUP sans article + quantité orpheline
  ["citron", XL("unité "), 1, { n: 0.38 }, { n: 0.38 }],
  ["Total prix de revient HT", null, null, null, { n: 1.18 }],
  [], ["Technique de prépartion"], ["Versez le rhum."], ["Servez frais."],
];

describe("lecture d'une fiche du bar (mise en page construite)", () => {
  it("repère tout par les libellés, colonne A comme colonne B ; ignore les lignes sans article", async () => {
    for (const depart of [0, 1]) {
      const r = await lireClasseurBar(await classeur({ "Mojito test": feuilleType("Cocktail", "Mojito"), Notes: [["rien ici"]] }, depart));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.autres).toEqual([{ feuille: "Notes", raison: expect.stringContaining("FICHE TECHNIQUE") }]);
      expect(r.fiches).toEqual([{
        feuille: "Mojito test", type: "Cocktail", nom: "Mojito", verres: 2, prixTTC: 12.345, tauxTVA: 0.16,
        modes: ["Blender"], verre: "Verre à cocktail",
        lignes: [
          { libelle: "Rhum blanc", unite: "cl", quantite: 4, coutUnitaire: 0.2 },
          // « unité » (espace final) : la valeur en cache d'une formule <v xml:space="preserve"> est lue.
          { libelle: "citron", unite: "unité", quantite: 1, coutUnitaire: 0.38 },
        ],
        technique: ["Versez le rhum.", "Servez frais."],
      }]);
    }
  });

  it("ligne « Total » absente : la technique clôt le tableau, elle n'y entre jamais", async () => {
    const sansTotal = feuilleType("Cocktail", "Mojito").filter((r) => r[0] !== "Total prix de revient HT");
    const r = await lireClasseurBar(await classeur({ M: sansTotal }));
    if (!r.ok) throw new Error(r.erreur);
    expect(r.fiches[0]!.lignes.map((l) => l.libelle)).toEqual(["Rhum blanc", "citron"]);
    expect(r.fiches[0]!.technique).toEqual(["Versez le rhum.", "Servez frais."]);
  });

  it("deux onglets de même nom normalisé : aucun n'écrase l'autre", async () => {
    const r = await lireClasseurBar(await classeur({ "Pina colada": feuilleType("Cocktail", "Pina colada"), "Piña colada": feuilleType("Mocktail", "Piña colada") }));
    if (!r.ok) throw new Error(r.erreur);
    expect(r.fiches.map((f) => [f.feuille, f.type])).toEqual([["Pina colada", "Cocktail"], ["Piña colada", "Mocktail"]]);
  });

  it("un classeur sans aucune fiche technique est refusé en clair", async () => {
    const r = await lireClasseurBar(await classeur({ Feuil1: [["Designation/Date", "Lundi"]] }));
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining("pas un classeur de fiches techniques du bar") });
    expect(await lireClasseurBar(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, erreur: expect.stringContaining("illisible") });
  });
});

describe("lecture du VRAI classeur de la Direction", () => {
  it("29 feuilles de fiche lues, « Liste des fournisseurs » laissée de côté, 55 ingrédients distincts", async () => {
    const r = await lireClasseurBar(fs.readFileSync(FIXTURE));
    if (!r.ok) throw new Error(r.erreur);
    expect(r.autres.map((a) => a.feuille)).toEqual(["Liste des fournisseurs"]);
    expect(r.fiches.map((f) => [f.type, f.nom, f.lignes.length])).toEqual([
      ["Cocktail", "Piña colada", 5], ["Mocktail", "Virgin Piña Colada", 4], ["Cocktail", "Blue Hawaiian", 5],
      ["Mocktail", "Bora Bora", 4], ["Mocktail", "Virgin Mojito", 5], ["Cocktail", "Mojito", 5],
      ["Cocktail", "Sex on the beach", 5], ["Cocktail", "Cosmopolitan", 4], ["Cocktail", "Daïquiri", 3],
      ["Cocktail", "TEQUILA SUNRISE", 3], ["Cocktail", "Long Island", 7], ["Cocktail", "Espresso Martini", 4],
      ["Cocktail", "Caïpirinha", 3], ["Cocktail", "Margarita", 3], ["Cocktail", "Negroni", 3],
      ["Cocktail", "Old Fashioned", 3], ["Mocktail", "Pop Cola", 5], ["Cocktail", "Pop Cola", 6],
      ["Cocktail", "Spanish latte arômatisé", 4], ["Cocktail", "Milkshake fraise", 3], ["Mocktail", "Frozen Kiwi", 2],
      ["Mocktail", "Smoothie kiwi yuzu", 4], ["Milkshake", "Milkshake Pomme", 4], ["Mocktail", "Folie Douce", 4],
      ["Cocktail", "Jäger Naughty German", 4], ["Cocktail", "Blue Lady", 4], ["Cocktail", "Pink Lady", 4],
      ["Cocktail", "Apérol Spritz", 3], ["Cocktail", "Kir Royal", 2],
    ]);
    const pina = r.fiches[0]!;
    expect(pina).toMatchObject({ feuille: "Pinacolada cocktail", verres: 1, tauxTVA: 0.16, verre: "Verre à cocktail", modes: [] });
    expect(pina.prixTTC).toBeCloseTo(15.0162, 4);
    expect(pina.lignes.map((l) => [l.libelle, l.unite, l.quantite])).toEqual([
      ["Jus d'Ananas-100", "cl", 12], ["Lait de Coco", "cl", 5], ["Sirop de Sucre de canne-70", "cl", 1],
      ["MONIN COCONUT FRUIT 1LTR", "cl", 5], ["BACARDI BLC 1L", "cl", 5],
    ]);
    expect(pina.technique).toHaveLength(3);
    // Caïpirinha : la quantité « 2 » sans article sous le tableau n'est pas une ligne.
    expect(r.fiches.find((f) => f.nom === "Caïpirinha")!.lignes.map((l) => [l.libelle, l.unite])).toEqual([["Sucre Brun", "g"], ["citron", "unité"], ["AGUACANA CACHACA 75cl", "cl"]]);
    expect(r.fiches.find((f) => f.nom === "Frozen Kiwi")!.lignes[1]).toEqual({ libelle: "RED BULL 250 ML", unite: "ML", quantite: 150, coutUnitaire: 0.006679999999999999 });
    expect(r.fiches.find((f) => f.feuille === "Pop Cola cocktail")!.modes).toEqual(["Shaker"]);
    expect(r.fiches.find((f) => f.nom === "Mojito")!.technique).toHaveLength(12);

    const ingredients = rattacherIngredients(r.fiches, []);
    expect(ingredients).toHaveLength(55);
    expect(ingredients.filter((i) => i.unites.length !== 1)).toEqual([]); // chaque libellé : une seule unité
    expect(ingredients.every((i) => i.creation !== null)).toBe(true);
  });

  it.skipIf(!fs.existsSync(ORIGINAL))("le classeur ORIGINAL (photos comprises) se lit exactement comme la fixture", async () => {
    const [a, b] = await Promise.all([lireClasseurBar(fs.readFileSync(ORIGINAL)), lireClasseurBar(fs.readFileSync(FIXTURE))]);
    expect(a.ok && b.ok && a.fiches).toEqual(b.ok && b.fiches);
  });
});

// ─── Règle de correspondance ─────────────────────────────────────────────────

describe("règle de correspondance d'une feuille avec une fiche", () => {
  const C = (nom: string, type: string, ficheNom: string, categorie: string | null) => correspondanceFiche({ nom, type }, { nom: ficheNom, categorie });

  it("même nom (accents, casse, espaces, ponctuation) ET même famille", () => {
    expect(C("Piña colada", "Cocktail", "Pina Colada", "Cocktail")).toBe("exacte");
    expect(C("Sex on the beach ", "Cocktail", "Sex on the Beach", "Cocktails")).toBe("exacte");
    expect(C("TEQUILA SUNRISE", "Cocktail", "Tequila Sunrise", "cocktail")).toBe("exacte");
    expect(C("Daïquiri", "Cocktail", "Daiquiri", "Cocktail")).toBe("exacte");
    expect(C("Jäger Naughty-German", "Cocktail", "Jager Naughty German", "Cocktail")).toBe("exacte");
  });

  it("la famille départage : un cocktail n'est jamais le mocktail du même nom", () => {
    expect(C("Piña colada", "Cocktail", "Pina Colada", "Mocktail")).toBeNull();
    expect(C("Kir Royal", "Cocktail", "Kir Royal", "Apéritif")).toBeNull();
    expect(C("Kir Royal", "", "Kir Royal", "")).toBeNull(); // famille vide : rien
  });

  it("« virgin » : retiré en famille Mocktail ; ailleurs, seule sa place est libre", () => {
    expect(C("Virgin Mojito", "Mocktail", "Mojito Virgin", "Mocktail")).toBe("exacte");
    expect(C("Virgin Piña Colada", "Mocktail", "Pina Colada", "Mocktail")).toBe("exacte");
    expect(C("Virgin Mojito", "Cocktail", "Mojito Virgin", "Cocktail")).toBe("exacte");
    expect(C("Virgin Mojito", "Cocktail", "Mojito", "Cocktail")).toBeNull();
  });

  it("orthographe : UN mot d'au moins 6 lettres, à UNE lettre près — rien de plus", () => {
    expect(C("Blue Hawaiian", "Cocktail", "Blue Hawaian", "Cocktail")).toBe("orthographe");
    expect(C("Cosmopolitan", "Cocktail", "Cosmopolitain", "Cocktail")).toBe("orthographe");
    expect(C("Caipirihna", "Cocktail", "Caïpirinha", "Cocktail")).toBe("orthographe"); // deux lettres voisines inversées
    expect(C("Margarita", "Cocktail", "Margherita", "Cocktail")).toBeNull(); // deux lettres
    expect(C("Old Fashioned", "Cocktail", "Old Fashion", "Cocktail")).toBeNull();
    expect(C("Blue Lady", "Cocktail", "Pink Lady", "Cocktail")).toBeNull(); // mot court
    expect(C("Gin Fizz", "Cocktail", "Gin Fuzz", "Cocktail")).toBeNull(); // mot de 4 lettres
    expect(C("Blue Hawaiian", "Cocktail", "Blue Hawaian Royal", "Cocktail")).toBeNull(); // pas le même nombre de mots
    expect(C("Blu Hawaiian", "Cocktail", "Blue Hawaian", "Cocktail")).toBeNull(); // deux mots touchés
    expect(C("Mojito 12", "Cocktail", "Mojito 13", "Cocktail")).toBeNull(); // jamais sur un nombre
    expect(C("Negroni", "Cocktail", "Negroni Sbagliato", "Cocktail")).toBeNull();
  });
});

const F = (id: string, nom: string, categorie: string | null, extra: Partial<FicheExistanteBar> = {}): FicheExistanteBar =>
  ({ id, nom, categorie, type: "BAR", estSousRecette: false, actif: true, nbIngredients: 0, recetteVide: true, prixVenteTTC: 10, ...extra });

/** Les fiches BAR de la production telles que relevées le 2026-09-30 (noms et rubriques). */
const FICHES_PROD: FicheExistanteBar[] = [
  ...["Blue Hawaian", "Caïpirinha", "Cosmopolitain", "Daïquiri", "Long Island", "Margarita", "Mojito", "Negroni", "Pina Colada", "Sex on the beach", "Tequila Sunrise"].map((n, i) => F(`c${i}`, n, "Cocktail")),
  ...["Blue Hawaian", "Bora Bora", "Mojito Virgin", "Pina Colada", "Sex on the Beach"].map((n, i) => F(`m${i}`, n, "Mocktail")),
  F("a1", "Kir Royal", "Apéritif"), F("a2", "Spritz", "Apéritif"), F("b1", "Dalgona Coffee", "Boisson chaude"), F("b2", "Irish Coffee", "Boisson chaude"),
];

describe("rattachement des feuilles aux fiches", () => {
  it("VRAI classeur × fiches de la production : 14 correspondances sûres, 15 à décider", async () => {
    const r = await lireClasseurBar(fs.readFileSync(FIXTURE));
    if (!r.ok) throw new Error(r.erreur);
    const props = rattacherFiches(r.fiches, FICHES_PROD);
    const nom = (id: string | null) => FICHES_PROD.find((f) => f.id === id);
    expect(props.filter((p) => p.ficheId).map((p) => `${p.feuille} → ${nom(p.ficheId)!.nom} (${nom(p.ficheId)!.categorie}) ${p.correspondance}`)).toEqual([
      "Pinacolada cocktail → Pina Colada (Cocktail) exacte",
      "PinaColada mocktail → Pina Colada (Mocktail) exacte",
      "Blue Hawaiian cocktail → Blue Hawaian (Cocktail) orthographe",
      "Bora Bora mocktail → Bora Bora (Mocktail) exacte",
      "Virgin Mojito → Mojito Virgin (Mocktail) exacte",
      "Mojito → Mojito (Cocktail) exacte",
      "Sex on the beach cocktail → Sex on the beach (Cocktail) exacte",
      "Cosmopolitan → Cosmopolitain (Cocktail) orthographe",
      "Daïquiri → Daïquiri (Cocktail) exacte",
      "TEQUILA SUNRISE → Tequila Sunrise (Cocktail) exacte",
      "LONG ISLAND → Long Island (Cocktail) exacte",
      "Caïpirinha → Caïpirinha (Cocktail) exacte",
      "Margarita → Margarita (Cocktail) exacte",
      "Negroni → Negroni (Cocktail) exacte",
    ]);
    // Kir Royal existe, mais en « Apéritif » : proposé en tête de liste, JAMAIS choisi d'office.
    const kir = props.find((p) => p.feuille === "Kir royal")!;
    expect(kir.ficheId).toBeNull();
    expect(kir.suggestions).toEqual([{ id: "a1", libelle: "Kir Royal (Apéritif) — même nom, autre rubrique" }]);
    expect(props.find((p) => p.feuille === "Apérol Spritz")!.suggestions.map((s) => s.id)).toEqual(["a2"]);
    expect(props.find((p) => p.feuille === "Pop Cola mocktail")!.categorieProposee).toBe("Mocktail");
    expect(props.find((p) => p.feuille === "Milkshake pomme")!.categorieProposee).toBe("Milkshake");
  });

  it("deux candidates, ou deux feuilles pour une fiche : plus rien d'office", () => {
    const lue = (feuille: string, nom: string, type = "Cocktail"): FicheBarLue => ({ feuille, type, nom, verres: 1, prixTTC: 10, tauxTVA: 0.16, modes: [], verre: null, lignes: [], technique: [] });
    const deux = rattacherFiches([lue("A", "Mojito")], [F("1", "Mojito", "Cocktail"), F("2", "MOJITO", "Cocktails")]);
    expect(deux[0]).toMatchObject({ ficheId: null, doute: "2 fiches répondent au même nom dans cette rubrique" });
    // Une fiche exacte l'emporte sur une fiche « à une lettre près ».
    expect(rattacherFiches([lue("A", "Blue Hawaiian")], [F("1", "Blue Hawaian", "Cocktail"), F("2", "Blue Hawaiian", "Cocktail")])[0]!.ficheId).toBe("2");
    const doublon = rattacherFiches([lue("A", "Mojito"), lue("B", "mojito")], [F("1", "Mojito", "Cocktail")]);
    expect(doublon.map((p) => p.ficheId)).toEqual([null, null]);
    // Une fiche inactive n'est jamais choisie d'office, une sous-recette jamais proposée.
    expect(rattacherFiches([lue("A", "Mojito")], [F("1", "Mojito", "Cocktail", { actif: false })])[0]!.ficheId).toBeNull();
    expect(rattacherFiches([lue("A", "Mojito")], [F("1", "Mojito", "Cocktail", { estSousRecette: true })])[0]!.suggestions).toEqual([]);
  });
});

// ─── Ingrédients, unités, création ───────────────────────────────────────────

const A = (id: string, designation: string, unite: string | null, prix: number | null = 1, domaine: ArticleExistant["domaine"] = "BOISSON", contenance: [string, string] | null = null): ArticleExistant =>
  ({ id, designation, unite, prixUnitaireUSD: prix, domaine, contenance: contenance?.[0] ?? null, contenanceUnite: contenance?.[1] ?? null });

describe("ingrédients", () => {
  const lue: FicheBarLue = {
    feuille: "Mojito", type: "Cocktail", nom: "Mojito", verres: 1, prixTTC: 14.931281686, tauxTVA: 0.16, modes: [], verre: "Verre",
    lignes: [
      { libelle: "RUM SAINT JAMES BLC 70CL", unite: "cl", quantite: 8, coutUnitaire: 0.17857142857142858 },
      { libelle: "citron", unite: "unité", quantite: 1, coutUnitaire: 0.38496436 },
      { libelle: "Feuille de menthe", unite: "unité", quantite: 8, coutUnitaire: 0 },
    ],
    technique: ["Pilez."],
  };

  it("correspondance sûre = même désignation normalisée et UN seul article ; jamais « à une lettre près »", () => {
    const props = rattacherIngredients([lue], [A("r", "Rum Saint James blc 70cl", "Bouteille"), A("c1", "Citron", "Pièce"), A("c2", "CITRON", "kg"), A("m", "Feuilles de menthe", "botte")]);
    expect(props.map((p) => [p.libelle, p.articleId, p.doute])).toEqual([
      ["RUM SAINT JAMES BLC 70CL", "r", null],
      ["citron", null, "2 articles du catalogue ont ce nom et cette contenance"],
      ["Feuille de menthe", null, null],
    ]);
    expect(props[1]!.suggestions.slice(0, 2)).toEqual(["c1", "c2"]);
    expect(props[2]!.suggestions).toContain("m"); // proche : montré, jamais choisi
  });

  /** Le catalogue de PRODUCTION du bar (relevé en lecture seule le 2026-09-30) : désignation, unité. */
  const CATALOGUE_PROD: ArticleExistant[] = ([
    ["Absolut Vodka-75cl", "Bouteille"], ["Bacardi blanc-1l", "Bouteille"], ["Bard Liq Triple Sec-70cl", "Bouteille"], ["Cointreau-70cl", "Bouteille"],
    ["Campari-1L", "Bouteille(s)"], ["Aperol-1L", "Bouteille"], ["Hendrick S-700ml", "Bouteille"], ["Monin Coconut Fruit-1L", "Bouteille"],
    ["Monin Blue Curacao Liqueur-70cl", "Bouteille"], ["Monin- Curaçao Bleu-70cl", "Bouteille"], ["Monin Mojito Mint Sirop-1L", "Bouteille"],
    ["Monin Frappe Base Vanilla Powder 2KG", "Bouteille"], ["Monin Base Neutre Powder 2KG", "Bouteille"], ["Sirop de Sucre de canne-CANADOU-70cl", "Bouteille"],
    ["Scheweppes Soda-30cl", "Bouteille"], ["Coca Cola-30cl", "Bouteille"], ["Red bull-25cl", "Bouteille"], ["Ceres Orange-1L", "Bouteille"],
    ["Ceres-Cranberry 1L", "Bouteille"], ["Ceres-Mangue 1L", "Bouteille"], ["Ceres Fruit de la passion-1L", "Bouteille"], ["Jus d'Ananas-Ceres-1L", null],
    ["Rhum Saint James Blc-70cl", "Bouteille"], ["Camino Blanc-75cl", "Bouteille"], ["Martini Rosso-75cl", "Bouteille"],
    ["Piccini Prosecco Venetian Dress Extra Dry Blanc-75cl", "Bouteille"], ["Monin-Sirop de Grenadine-1L", "Bouteille"], ["Sirop de Grenadine-70cl", "Bouteille"],
    ["Monin-Sirop de pop corn-70cl", "Bouteille"], ["Beefeater Gin", "Bouteille"], ["Cassis", "Bouteille"], ["Triple sec", "Bouteille"], ["Crème de Coco", "Bouteille"],
    ["Lait de Coco", "cl"], ["ELLE & VIRE COOKING CREAM 1LTR", "L"], ["LAIT ELLE & VIRE ENTIER RED 1LTR", "L"], ["Sucre Brun", "kg"], ["Oeufs", "Unité"], ["Citron", "Kg"],
  ] as [string, string | null][]).map(([d, u], i) => A(`p${i}`, d, u));
  const nom = (id: string | null) => CATALOGUE_PROD.find((a) => a.id === id)?.designation ?? null;

  it("VRAI classeur × VRAI catalogue : sûr = mêmes mots ET même contenance ; les abréviations remontent en tête des proches", async () => {
    const r = await lireClasseurBar(fs.readFileSync(FIXTURE));
    if (!r.ok) throw new Error(r.erreur);
    const props = rattacherIngredients(r.fiches, CATALOGUE_PROD);
    const p = (libelle: string) => props.find((x) => x.libelle === libelle)!;
    // Correspondances SÛRES (mêmes mots, même contenance — ou aucune des deux côtés), un seul candidat.
    expect(props.filter((x) => x.articleId).map((x) => `${x.libelle} → ${nom(x.articleId)}`)).toEqual([
      "Lait de Coco → Lait de Coco",
      "MONIN COCONUT FRUIT 1LTR → Monin Coconut Fruit-1L",
      "MONIN MOJITO MINT SIROP 1LT → Monin Mojito Mint Sirop-1L",
      "citron → Citron",
      "ABSOLUT VODKA 75CL → Absolut Vodka-75cl",
      "COINTREAU 70CL → Cointreau-70cl",
      "BARD LIQ TRIPLE SEC 70CL → Bard Liq Triple Sec-70cl",
      "Sucre Brun → Sucre Brun",
      "CAMPARI 1L → Campari-1L",
      "MARTINI ROSSO 75CL → Martini Rosso-75cl",
      "ELLE & VIRE COOKING CREAM 1LTR → ELLE & VIRE COOKING CREAM 1LTR",
      "LAIT ELLE & VIRE ENTIER RED 1LTR → LAIT ELLE & VIRE ENTIER RED 1LTR",
      "MONIN FRAPPE BASE VANILLA POWDER 2KG → Monin Frappe Base Vanilla Powder 2KG",
      "RED BULL 250 ML → Red bull-25cl",
      "MONIN BASE NEUTRE POWDER 2KG → Monin Base Neutre Powder 2KG",
      "Oeufs → Oeufs",
      "APEROL 1LTR → Aperol-1L",
      "PICCINI PROSECCO VENETIAN DRESS EXTRA DRY BLANC 75CL → Piccini Prosecco Venetian Dress Extra Dry Blanc-75cl",
    ]);
    // Les 6 paires de la Direction : jamais sûres (abréviation, contenance absente d'un côté),
    // mais le bon article EN TÊTE des proches.
    expect(nom(p("BACARDI BLC 1L").suggestions[0]!)).toBe("Bacardi blanc-1l");
    expect(p("MONIN COCONUT FRUIT 1LTR").articleId).not.toBeNull(); // sûr : mêmes mots, 1 L des deux côtés
    expect(p("MONIN BLUE CURACAO 70CL").suggestions.slice(0, 2).map(nom).sort()).toEqual(["Monin Blue Curacao Liqueur-70cl", "Monin- Curaçao Bleu-70cl"]);
    expect(nom(p("RUM SAINT JAMES BLC 70CL").suggestions[0]!)).toBe("Rhum Saint James Blc-70cl");
    expect(nom(p("Scheweppes Soda").suggestions[0]!)).toBe("Scheweppes Soda-30cl");
    expect(nom(p("Jus d'Ananas-100").suggestions[0]!)).toBe("Jus d'Ananas-Ceres-1L");
    for (const l of ["BACARDI BLC 1L", "MONIN BLUE CURACAO 70CL", "RUM SAINT JAMES BLC 70CL", "Scheweppes Soda", "Jus d'Ananas-100"]) expect([l, p(l).articleId]).toEqual([l, null]);
  });

  it("classement des proches : abréviation (BLC ↔ blanc, LIQ ↔ liqueur) et lettre d'écart (RUM ↔ rhum) comptent ; un seul mot commun ne suffit pas", () => {
    const sc = (a: string, b: string) => scoreProche(formeArticle(a), formeArticle(b));
    expect(sc("BACARDI BLC 1L", "Bacardi blanc-1l")).toBeGreaterThan(sc("BACARDI BLC 1L", "Bacardi Oro-1l"));
    expect(sc("BARD LIQ TRIPLE SEC 70CL", "Bard Liqueur Triple Sec-70cl")).toBeGreaterThan(sc("BARD LIQ TRIPLE SEC 70CL", "Bard Lime Triple Sec-70cl"));
    expect(sc("RUM SAINT JAMES 70CL", "Rhum Saint James-70cl")).toBeGreaterThan(sc("RUM SAINT JAMES 70CL", "Gin Saint James-70cl"));
    expect(sc("MONIN SIROP CHOCO BLANC 70CL", "Rum Saint James blc 70cl")).toBe(0); // « blanc » + 70 cl : rien
    expect(sc("Scheweppes Soda", "Scheweppes Soda-30cl")).toBe(1); // contenance d'un seul côté : ni bonus ni malus
    expect(sc("Absolut Vodka 70cl", "Absolut Vodka-75cl")).toBe(0.75); // contenances différentes : malus
  });

  it("contenance : exigée dès qu'UNE des unités du libellé ne se convertit pas ; « Créer » vise l'article du même nom", () => {
    const b = A("b", "Monin Coconut Fruit-1L", "Bouteille");
    expect(contenanceRequise(b, ["Bouteille"])).toBe(false);
    expect(contenanceRequise(b, ["Bouteille", "cl"])).toBe(true);
    expect(contenanceRequise(b, "cl")).toBe(true);
    // « unité » / « pièce » sur une Bouteille : une contenance n'y changerait rien — pas de champ.
    expect(contenanceRequise(b, ["unité"])).toBe(false);
    expect(contenanceRequise(b, ["Bouteille", "pièce"])).toBe(false);
    expect(contenanceRequise(b, ["unité", "g"])).toBe(true);
    expect(contenanceRequise(A("s", "Citron-sac", null), ["unité"])).toBe(false); // sans unité, consommé à l'unité : rien à demander
    expect(contenanceRequise(A("k", "Sucre", "kg"), ["g"])).toBe(false); // pas compté à l'unité
    expect(contenanceRequise(A("s", "Jus-1L", null), ["cl"])).toBe(true); // sans unité
    expect(articleVise("MONIN COCONUT FRUIT 1LTR", "creer", [b])).toBe(b);
    expect(articleVise("MONIN COCONUT FRUIT 70CL", "creer", [b])).toBeNull();
    expect(articleVise("x", "art:b", [b])).toBe(b);
    expect(articleVise("x", "ignorer", [b])).toBeNull();
  });

  it("article SANS unité : l'unité de stock n'est jamais supposée ; une seule règle de validation (celle du catalogue)", () => {
    const jus = A("j", "Jus d'Ananas-Ceres-1L", null, 2.86);
    expect(contenanceProposee(jus)).toEqual({ quantite: "1", unite: "l", uniteStock: null, lue: true });
    expect(erreurContenanceChoisie({ quantite: "1", unite: "l", uniteStock: null }, jus)).toBe("article sans unité : choisir son unité de stock (son prix de 2.86 $ est « par ? »)");
    expect(erreurContenanceChoisie({ quantite: "1", unite: "l", uniteStock: "Brique" }, jus)).toBeNull();
    const bouteille = A("b", "Rhum", "Bouteille");
    expect(erreurContenanceChoisie({ quantite: "1e5", unite: "cl", uniteStock: null }, bouteille)).toBe("Contenance : nombre illisible.");
    expect(erreurContenanceChoisie({ quantite: "0x10", unite: "cl", uniteStock: null }, bouteille)).toBe("Contenance : nombre illisible.");
    expect(erreurContenanceChoisie({ quantite: "0,0004", unite: "l", uniteStock: null }, bouteille)).toBe("Contenance : 3 décimales au plus.");
    expect(erreurContenanceChoisie({ quantite: "0", unite: "cl", uniteStock: null }, bouteille)).toBe("Contenance : un nombre supérieur à 0 est attendu.");
    expect(erreurContenanceChoisie({ quantite: "70", unite: "bouteille", uniteStock: null }, bouteille)).toMatch(/nombre ET une unité/);
    expect(erreurContenanceChoisie({ quantite: "0,75", unite: "l", uniteStock: null }, bouteille)).toBeNull();
  });

  it("règle sûre : une contenance différente ou absente d'un seul côté n'est jamais le même article", () => {
    const f = (a: string, b: string) => memeArticle(formeArticle(a), formeArticle(b));
    expect(f("MONIN COCONUT FRUIT 1LTR", "Monin Coconut Fruit-1L")).toBe(true);
    expect(f("VODKA ABSOLUT 750ML", "Vodka Absolut-75cl")).toBe(true);
    expect(f("Jus d'Orange", "Jus Orange")).toBe(true); // mots vides et séparateurs
    expect(f("Absolut Vodka 70cl", "Absolut Vodka-75cl")).toBe(false);
    expect(f("Scheweppes Soda", "Scheweppes Soda-30cl")).toBe(false);
    expect(f("BACARDI BLC 1L", "Bacardi blanc-1l")).toBe(false);
    expect(f("Absolut Vodka", "Vodka Absolut")).toBe(false); // l'ordre des mots compte
    // Un nombre collé à un séparateur n'est pas une contenance : il reste dans les mots.
    expect(f("Vodka .7L", "Vodka")).toBe(false);
    expect(f("Vin 1/2 L", "Vin 1")).toBe(false);
  });

  it("valeurs de création : prix ramené au litre / au kilo ; prix nul ou absent = SANS prix, jamais 0", () => {
    expect(valeursCreation("ABSOLUT VODKA 75CL", "cl", 0.12)).toEqual({ designation: "ABSOLUT VODKA 75CL", unite: "l", prixUnitaireUSD: "12", prixClasseur: 0.12, uniteClasseur: "cl" });
    expect(valeursCreation("Sucre Brun", "g", 0.00138)).toMatchObject({ unite: "kg", prixUnitaireUSD: "1.38" });
    expect(valeursCreation("RED BULL 250 ML", "ML", 0.00668)).toMatchObject({ unite: "l", prixUnitaireUSD: "6.68" });
    expect(valeursCreation("Sirop de Sucre de canne-70", "cl", 0.17142857142857143)).toMatchObject({ unite: "l", prixUnitaireUSD: "17.1429" });
    expect(valeursCreation("citron", "unité ", 0.38496436)).toMatchObject({ unite: "unité", prixUnitaireUSD: "0.385" });
    expect(valeursCreation("Feuille de menthe", "unité", 0)).toMatchObject({ prixUnitaireUSD: null, prixClasseur: null });
    expect(valeursCreation("Glace", "cl", null)).toMatchObject({ prixUnitaireUSD: null });
  });

  it("uniteConvertible dit exactement ce que dit le moteur de coût", () => {
    const cas: [string, string | null, string | null, string | null][] = [
      ["cl", "l", null, null], ["cl", "L", null, null], ["cl", "Litres", null, null], ["ml", "cl", null, null], ["g", "kg", null, null],
      ["g", "500 GR", null, null], ["cl", "500 GR", null, null], ["unité", "Unité", null, null], ["unité", "pièce", null, null],
      ["cl", "Bouteille", null, null], ["cl", "bouteille 75cl", null, null], ["unité", "kg", null, null], ["cl", "", null, null], ["cl", null, null, null], ["", "cl", null, null],
      // Contenance d'un article compté à l'unité.
      ["cl", "Bouteille", "75", "cl"], ["ml", "Bouteille(s)", "1", "l"], ["g", "Bouteille", "2", "kg"], ["g", "Bouteille", "75", "cl"], ["cl", "Carton", "75", "cl"], ["cl", "", "1", "l"],
    ];
    for (const [conso, achat, contenance, contenanceUnite] of cas) {
      const article = { prixUnitaireUSD: 1, unite: achat ?? "", contenance, contenanceUnite };
      const r = calculerCout({ id: "f", nbPortions: 1, tauxTVA: 0.16, estSousRecette: false, ingredients: [{ unite: conso, quantite: 1, article }] });
      const moteur = r.lignes[0]!.motif !== "UNITE_INCONVERTIBLE";
      expect([conso, achat, contenance, uniteConvertible(conso, { unite: achat, contenance, contenanceUnite })]).toEqual([conso, achat, contenance, moteur]);
    }
  });
});

// ─── Plan ────────────────────────────────────────────────────────────────────

describe("plan d'import (simulation = écriture)", () => {
  const lue = (feuille: string, nom: string, lignes: FicheBarLue["lignes"], type = "Cocktail"): FicheBarLue =>
    ({ feuille, type, nom, verres: 1, prixTTC: 12.345, tauxTVA: 0.16, modes: ["Shaker"], verre: "Verre à cocktail", lignes, technique: ["Secouez."] });
  const rhum = { libelle: "Rhum blanc", unite: "cl", quantite: 4, coutUnitaire: 0.2 };
  const menthe = { libelle: "Feuille de menthe", unite: "unité", quantite: 8, coutUnitaire: 0 };
  const plan = (lues: FicheBarLue[], choix: ChoixImportBar, articles: ArticleExistant[], fiches: FicheExistanteBar[]) =>
    planifierImportBar(lues, choix, articles, fiches, rattacherIngredients(lues, articles));

  it("correspondances sûres acceptées d'office ; ingrédient inconnu = fiche à décider", () => {
    const lues = [lue("M", "Mojito", [rhum, menthe])];
    const articles = [A("r", "Rhum blanc", "L", 20)];
    const fiches = [F("f", "Mojito", "Cocktail")];
    const choix = choixInitiaux(rattacherFiches(lues, fiches), rattacherIngredients(lues, articles));
    expect(choix.fiches.M!.cible).toBe("fiche:f");
    expect(choix.ingredients["feuille de menthe"]).toEqual({ cible: "", domaine: "NOURRITURE" });
    const [p] = plan(lues, choix, articles, fiches);
    expect(p).toMatchObject({ statut: "A_DECIDER", raisons: ["1 ingrédient(s) à décider"] });
    // Ignorer la ligne : la fiche est prête, et la ligne est notée dans la recette.
    choix.ingredients["feuille de menthe"]!.cible = "ignorer";
    const [q] = plan(lues, choix, articles, fiches);
    expect(q!.statut).toBe("PRETE");
    expect(q!.recette).toBe("Verre : Verre à cocktail\nMode : Shaker\n\nSecouez.\n\nNon repris du classeur : Feuille de menthe (8 unité).");
    expect(q!.lignes.map((l) => [l.statut, l.article?.id])).toEqual([["OK", "r"], ["IGNOREE", undefined]]);
  });

  it("unité inconvertible pour l'article choisi = ligne BLOQUÉE, fiche non écrite", () => {
    const lues = [lue("M", "Mojito", [rhum])];
    const choix: ChoixImportBar = { fiches: { M: { cible: "fiche:f", categorie: "", remplacer: false } }, ingredients: { "rhum blanc": { cible: "art:k", domaine: "BOISSON" } }, contenances: {} };
    const [p] = plan(lues, choix, [A("k", "Rhum blanc", "kg", 18)], [F("f", "Mojito", "Cocktail")]);
    expect(p).toMatchObject({ statut: "BLOQUEE", raisons: ["Rhum blanc : unité inconvertible : cl → kg"] });
  });

  it("bouteille sans contenance : bloquée tant qu'elle manque ; saisie → prête, à écrire sur l'article ; jamais par-dessus une contenance connue", () => {
    const lues = [lue("M", "Mojito", [rhum])];
    const choix: ChoixImportBar = { fiches: { M: { cible: "fiche:f", categorie: "", remplacer: false } }, ingredients: { "rhum blanc": { cible: "art:b", domaine: "BOISSON" } }, contenances: {} };
    const fiches = [F("f", "Mojito", "Cocktail")];
    const bouteille = A("b", "Rhum blanc", "Bouteille", 18);
    expect(plan(lues, choix, [bouteille], fiches)[0]).toMatchObject({ statut: "BLOQUEE", raisons: ["Rhum blanc : contenance de « Rhum blanc » à renseigner (1 Bouteille = combien ?)"] });
    choix.contenances.b = { quantite: "0", unite: "cl", uniteStock: null };
    expect(plan(lues, choix, [bouteille], fiches)[0]!.statut).toBe("BLOQUEE"); // 0 n'est pas une contenance
    choix.contenances.b = { quantite: "70", unite: "cl", uniteStock: null };
    const [p] = plan(lues, choix, [bouteille], fiches);
    expect(p!.statut).toBe("PRETE");
    expect(p!.lignes[0]!.article).toEqual({ id: "b", designation: "Rhum blanc", unite: "Bouteille", contenanceAEcrire: { quantite: "70", unite: "cl", uniteStock: null } });
    // Contenance déjà au catalogue : elle fait foi, la saisie est ignorée, rien à écrire.
    const connue = A("b", "Rhum blanc", "Bouteille", 18, "BOISSON", ["1", "l"]);
    expect(plan(lues, choix, [connue], fiches)[0]!.lignes[0]!.article!.contenanceAEcrire).toBeNull();
    // Contenance à la virgule : écrite sous la forme canonique de la règle unique.
    choix.contenances.b = { quantite: "0,7", unite: "l", uniteStock: null };
    expect(plan(lues, choix, [bouteille], fiches)[0]!.lignes[0]!.article!.contenanceAEcrire).toEqual({ quantite: "0.7", unite: "l", uniteStock: null });
    choix.contenances.b = { quantite: "1e2", unite: "cl", uniteStock: null };
    expect(plan(lues, choix, [bouteille], fiches)[0]).toMatchObject({ statut: "BLOQUEE", raisons: ["Rhum blanc : contenance de « Rhum blanc » à renseigner (Contenance : nombre illisible.)"] });
    // Article sans unité : l'unité de stock se choisit avec la contenance.
    const sansUnite = A("b", "Jus d'Ananas-Ceres-1L", null, 2);
    choix.contenances.b = { quantite: "1", unite: "l", uniteStock: null };
    expect(plan(lues, choix, [sansUnite], fiches)[0]!.statut).toBe("BLOQUEE");
    choix.contenances.b = { quantite: "1", unite: "l", uniteStock: "Brique" };
    expect(plan(lues, choix, [sansUnite], fiches)[0]!.lignes[0]!.article).toMatchObject({ unite: "Brique", contenanceAEcrire: { quantite: "1", unite: "l", uniteStock: "Brique" } });
  });

  it("fiche déjà remplie : laissée telle quelle sans la case « Remplacer »", () => {
    const lues = [lue("M", "Mojito", [rhum])];
    const choix: ChoixImportBar = { fiches: { M: { cible: "fiche:f", categorie: "", remplacer: false } }, ingredients: { "rhum blanc": { cible: "art:r", domaine: "BOISSON" } }, contenances: {} };
    const articles = [A("r", "Rhum blanc", "L", 20)];
    const fiches = [F("f", "Mojito", "Cocktail", { nbIngredients: 3 })];
    expect(plan(lues, choix, articles, fiches)[0]!.statut).toBe("DEJA_REMPLIE");
    choix.fiches.M!.remplacer = true;
    expect(plan(lues, choix, articles, fiches)[0]!.statut).toBe("PRETE");
  });

  it("« Créer » réutilise la fiche et l'article du même nom : relancer ne duplique rien", () => {
    const lues = [lue("M", "Mojito", [rhum])];
    const choix: ChoixImportBar = { fiches: { M: { cible: "creer", categorie: "Cocktails", remplacer: false } }, ingredients: { "rhum blanc": { cible: "creer", domaine: "BOISSON" } }, contenances: {} };
    const neuf = plan(lues, choix, [], [])[0]!;
    expect(neuf.cible).toEqual({ id: null, nom: "Mojito", categorie: "Cocktails", nbIngredients: 0, recetteVide: true, prixVenteTTC: 12.35 });
    expect(neuf.lignes[0]!.article).toEqual({ id: null, designation: "Rhum blanc", unite: "l", contenanceAEcrire: null });
    const relance = plan(lues, choix, [A("r", "RHUM BLANC", "l", 20)], [F("f", "mojito", "Cocktail", { nbIngredients: 1 })])[0]!;
    expect(relance).toMatchObject({ statut: "DEJA_REMPLIE", cible: { id: "f" } });
    expect(relance.lignes[0]!.article!.id).toBe("r");
  });

  it("« Créer » face à une fiche INACTIVE du même nom : bloqué, jamais réutilisée en silence", () => {
    const lues = [lue("M", "Mojito", [rhum])];
    const choix: ChoixImportBar = { fiches: { M: { cible: "creer", categorie: "Cocktail", remplacer: false } }, ingredients: { "rhum blanc": { cible: "art:r", domaine: "BOISSON" } }, contenances: {} };
    const [p] = plan(lues, choix, [A("r", "Rhum blanc", "l")], [F("f", "Mojito", "Cocktail", { actif: false })]);
    expect(p).toMatchObject({ statut: "BLOQUEE", raisons: [expect.stringContaining("fiche INACTIVE")] });
  });

  it("quantité à plus de 3 décimales (la base en garde 3) : bloquée, jamais arrondie en silence", () => {
    const lues = [lue("M", "Mojito", [{ ...rhum, quantite: 0.0004 }])];
    const choix: ChoixImportBar = { fiches: { M: { cible: "fiche:f", categorie: "", remplacer: false } }, ingredients: { "rhum blanc": { cible: "art:r", domaine: "BOISSON" } }, contenances: {} };
    const [p] = plan(lues, choix, [A("r", "Rhum blanc", "l")], [F("f", "Mojito", "Cocktail")]);
    expect(p).toMatchObject({ statut: "BLOQUEE", raisons: ["Rhum blanc : quantité 0.0004 : plus de 3 décimales, à arrondir dans le classeur"] });
  });

  it("deux feuilles vers la même fiche : aucune n'est écrite", () => {
    const lues = [lue("A", "Mojito", [rhum]), lue("B", "Mojito bis", [rhum])];
    const c = { cible: "fiche:f", categorie: "", remplacer: false };
    const plans = plan(lues, { fiches: { A: c, B: c }, ingredients: { "rhum blanc": { cible: "art:r", domaine: "BOISSON" } }, contenances: {} }, [A("r", "Rhum blanc", "l")], [F("f", "Mojito", "Cocktail")]);
    expect(plans.map((p) => p.statut)).toEqual(["BLOQUEE", "BLOQUEE"]);
    expect(plans[0]!.raisons).toContain("vise la même fiche que « B »");
  });
});

describe("validation de la charge reçue", () => {
  it("refuse une forme inattendue, accepte la lecture du vrai classeur", async () => {
    const r = await lireClasseurBar(fs.readFileSync(FIXTURE));
    if (!r.ok) throw new Error(r.erreur);
    expect(validerFichesLues(JSON.parse(JSON.stringify(r.fiches)))).toEqual(r.fiches);
    expect(() => validerFichesLues([])).toThrow(/Aucune fiche/);
    expect(() => validerFichesLues([{ ...r.fiches[0], lignes: [{ libelle: "x", quantite: "12" }] }])).toThrow(/illisible/);
    expect(() => validerFichesLues([r.fiches[0], r.fiches[0]])).toThrow(/en double/);
    expect(() => validerChoix({ fiches: { [r.fiches[0]!.feuille]: { cible: "fiche:'; drop" } }, ingredients: {} }, r.fiches)).toThrow(/illisible/);
    expect(validerChoix({ fiches: {}, ingredients: { x: { cible: "creer", domaine: "PIRATE" } } }, r.fiches).ingredients.x).toEqual({ cible: "creer", domaine: "BOISSON" });
  });
});
