import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import * as XLSX from "xlsx";
import Decimal from "decimal.js";
import { calculerCout, type FicheCalc } from "@/lib/fiches/cout";
import {
  analyserClasseur,
  detecterEcartsPrix,
  extraireRendement,
  lireFiche,
  localiserColonnesArticles,
  normaliserDesignation,
  simulerCouts,
  type LigneArticle,
} from "./import-fiches-plats";

// Tests du PARSEUR en marche à vide : aucune base, aucune écriture, aucun accès Prisma.
//
// Deux niveaux :
//  1. un classeur SYNTHÉTIQUE reconstruit ici, volontairement DÉCALÉ d'un onglet à l'autre —
//     il prouve l'ancrage sur les libellés de la colonne B (une coordonnée codée en dur
//     échouerait) et il tourne partout, y compris sans le fichier de la Direction ;
//  2. le classeur RÉEL de la Direction quand il est présent sur la machine — il verrouille les
//     chiffres remontés dans le rapport (29 onglets, 121 ingrédients, 0 non rattaché…).

const CHEMIN_REEL = "/Users/sachatshiongo/Downloads/Tableurs/Fiche technique plats crash test.xlsx";

// ─── Fabrique de classeur synthétique ────────────────────────────────────────

function feuille(cellules: Record<string, string | number>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  for (const [adresse, v] of Object.entries(cellules)) {
    ws[adresse] = { t: typeof v === "number" ? "n" : "s", v };
  }
  const coords = Object.keys(cellules).map((a) => XLSX.utils.decode_cell(a));
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: Math.min(...coords.map((c) => c.r)), c: Math.min(...coords.map((c) => c.c)) },
    e: { r: Math.max(...coords.map((c) => c.r)), c: Math.max(...coords.map((c) => c.c)) },
  });
  return ws;
}

/** Sous-recette « Sauce bolognaise 4.6 kg » : mise en page A (tableau à partir de la ligne 25). */
const SAUCE_BOLOGNAISE = feuille({
  B9: "FICHE TECHNIQUE",
  B11: "Pâtes classiques",
  B13: "Sauce bolognaise 4.6 kg ",
  B15: "Nombre de portions :", C15: 23,
  B17: "Prix de vente TTC :", C17: 10.030610997460869,
  B18: "Taux TVA :", C18: 0.16,
  B25: "Article", C25: "Unité ", D25: "Unités nécessaires", E25: "Coût d'achat HT à l'unité", F25: "Prix de revient HT",
  B26: "Viande Hachée", C26: "Kg", D26: 2.2,
  B27: "Tomates pêlées 240g ", C27: "Pièce", D27: 5,
  B28: "Tomates concentrées", C28: "Pièce", D28: 3,
  B29: "Vin rouge", C29: "Bouteille", D29: 3,
  B30: "LAIT ELLE & VIRE ENTIER RED 1LTR", C30: "L", D30: 1.25,
  B31: "Huile 1L régina", C31: "L", D31: 0.13333,
  B32: "Carottes", C32: "kg", D32: 0.28,
  C33: 0, E33: 0, F33: 0, // lignes de remplissage du classeur : ignorées
  C34: 0, E34: 0, F34: 0,
  B37: "Total prix de revient HT", F37: 56.82365836,
  B40: "Coefficient de marge", F40: 3.5,
  B45: "Recette ",
});

/**
 * Plat « Bolognaise » : mise en page B, DÉCALÉE de 3 lignes par rapport à la sous-recette.
 * C'est exactement le piège du classeur réel (tableau ligne 21 sur une fiche, ligne 31 sur une
 * autre) : un import ancré sur « C15 »/« B26 » lirait ici des cellules vides.
 */
const BOLOGNAISE = feuille({
  B12: "FICHE TECHNIQUE",
  B14: "Pâtes classiques",
  B16: "Bolognaise ",
  B18: "Nombre de portions :", C18: 1,
  B20: "Prix de vente TTC :", C20: 23.478399999999997,
  B21: "Taux TVA :", C21: 0.16,
  B28: "Article", C28: "Unité ", D28: "Unités nécessaires",
  B29: "Sauce bolognaise ", C29: "cl ", D29: 200,
  B30: "20 PENNE RIGATE LM CHEF 12 X 1KG", C30: "Kg", D30: 0.2,
  C31: 0, E31: 0, F31: 0,
  B34: "Total prix de revient HT", F34: 2.53,
  B37: "Coefficient de marge", F37: 8,
});

/** Liste des articles : entête DÉCALÉE en ligne 17, et « Fournisseur » présent des deux côtés. */
const LISTE_ARTICLES = feuille({
  B15: "LISTE DES FOURNISSEURS", R15: "LISTE DES ARTICLES",
  B17: "Fournisseur", C17: "Produits", D17: "Téléphone",
  R17: "BARCODE", S17: "Désignation ", T17: "Unité", U17: "Quantité par paquet ",
  V17: "PRIX à l'unité ", W17: "PRIX CRT", X17: "FOURNISSEUR",
  B18: "SO GOOD", S18: "20 PENNE RIGATE LM CHEF 12 X 1KG", T18: "Kg", U18: 12, V18: 0.35, W18: 42, X18: "SO GOOD",
  B19: "REGAL", S19: "LAIT ELLE & VIRE ENTIER RED 1LTR", T19: "L", U19: 24, V19: 2.5, W19: 60, X19: "REGAL",
  S20: "Viande Hachée", T20: "Kg", U20: "Viande -Volaille-Poisson-Crustacé", V20: 8.07,
  S21: "Tomates pêlées 240g ", T21: "Pièce", V21: 1.34,
  S22: "Tomates concentrées", T22: "Pièce", V22: 0.21,
  S23: "Vin rouge", T23: "Bouteille", V23: 9,
  S24: "Huile 1L régina", T24: "L", V24: 2.492,
  S25: "Carottes", T25: "kg", V25: 4.58, W25: 0,
  // « Fausse ligne » : la Direction recopie ses sous-recettes dans la liste des articles.
  S26: "Sauce bolognaise ", T26: "cl ", V26: 0.0123, W26: 0,
});

function classeurSynthetique(): XLSX.WorkBook {
  return {
    SheetNames: ["Sauce bolognaise", "Bolognaise", "Liste des articles"],
    Sheets: {
      "Sauce bolognaise": SAUCE_BOLOGNAISE,
      Bolognaise: BOLOGNAISE,
      "Liste des articles": LISTE_ARTICLES,
    },
  };
}

// ─── 1. Fonctions pures ──────────────────────────────────────────────────────

describe("normaliserDesignation — clé de rapprochement", () => {
  it("ignore casse, accents, espaces multiples et espaces de bord", () => {
    expect(normaliserDesignation("  Sauce   bolognaise ")).toBe("sauce bolognaise");
    expect(normaliserDesignation("ÉPINARDS")).toBe(normaliserDesignation("Épinards"));
    expect(normaliserDesignation("CAILLES")).toBe(normaliserDesignation("Cailles"));
  });

  it("ne rapproche PAS deux désignations réellement différentes", () => {
    expect(normaliserDesignation("Saumon Fumé")).not.toBe(normaliserDesignation("SAUMON FRAIS 1KG"));
    expect(normaliserDesignation("Sauce bolognaise")).not.toBe(normaliserDesignation("Sauce barbecue"));
  });
});

describe("extraireRendement — TOUJOURS en grammes, jamais en kg", () => {
  it("« Sauce bolognaise 4.6 kg » → 4600 g, nom nettoyé", () => {
    const r = extraireRendement("Sauce bolognaise 4.6 kg ");
    expect(r.quantiteG).toBe(4600);
    expect(r.nom).toBe("Sauce bolognaise");
    expect(r.uniteSource).toBe("kg");
  });

  it("« Coulis de tomate 1kg » (sans espace) → 1000 g", () => {
    expect(extraireRendement("Coulis de tomate 1kg").quantiteG).toBe(1000);
    expect(extraireRendement("Coulis de tomate 1kg").nom).toBe("Coulis de tomate");
  });

  it("accepte la virgule décimale et les autres unités, toujours ramenées au gramme", () => {
    expect(extraireRendement("Sauce 4,6 KG").quantiteG).toBe(4600);
    expect(extraireRendement("Fond 250 g").quantiteG).toBe(250);
    expect(extraireRendement("Jus 2 L").quantiteG).toBe(2000); // densité 1, convention du moteur
    expect(extraireRendement("Coulis 50 cl").quantiteG).toBe(500);
  });

  it("ne devine aucun rendement quand le nom n'en porte pas", () => {
    expect(extraireRendement("Béchamel").quantiteG).toBeNull();
    expect(extraireRendement("Bisque de cossas ").quantiteG).toBeNull();
    expect(extraireRendement("Trio de cailles ").quantiteG).toBeNull();
  });

  it("ne confond pas un chiffre de désignation avec un rendement (pas en fin de nom)", () => {
    expect(extraireRendement("Lasagne 12 X 500G maison").quantiteG).toBeNull();
  });
});

describe("le piège du rendement en « kg » — pourquoi l'import écrit toujours « g »", () => {
  const bolognaise: FicheCalc = {
    id: "plat",
    nbPortions: 1,
    tauxTVA: 0.16,
    estSousRecette: false,
    ingredients: [{ nom: "Sauce bolognaise", unite: "cl", quantite: 200, sousFicheId: "sauce" }],
  };
  const sauce = (rendementQuantite: number, rendementUnite: string): FicheCalc => ({
    id: "sauce",
    nom: "Sauce bolognaise",
    nbPortions: 23,
    tauxTVA: 0.16,
    estSousRecette: true,
    rendementQuantite,
    rendementUnite,
    ingredients: [{ nom: "Viande Hachée", unite: "Kg", quantite: 2.2, article: { prixUnitaireUSD: 8.07, unite: "Kg" } }],
  });

  it("rendement en « kg » → coût INDÉTERMINÉ chez toutes les fiches qui l'utilisent", () => {
    const r = calculerCout(bolognaise, { fiches: new Map([["sauce", sauce(4.6, "kg")]]) });
    expect(r.incomplet).toBe(true);
    expect(r.lignes[0]!.motif).toBe("UNITE_RENDEMENT_INCOHERENTE");
  });

  it("rendement en « g » (4600) → coût complet", () => {
    const r = calculerCout(bolognaise, { fiches: new Map([["sauce", sauce(4600, "g")]]) });
    expect(r.incomplet).toBe(false);
    expect(r.lignes[0]!.cout).not.toBeNull();
  });
});

describe("detecterEcartsPrix — signale, ne corrige pas", () => {
  const ligne = (p: Partial<LigneArticle>): LigneArticle => ({
    ligne: 1, designation: "X", cle: "x", codeBarresBrut: null, unite: "Kg",
    uniteParCarton: null, uniteParCartonBrut: null, prixUnitaireUSD: null,
    prixCartonUSD: null, fournisseur: null, ...p,
  });

  it("repère le facteur 10 des pennes (0,35 × 12 ≠ 42)", () => {
    const [e] = detecterEcartsPrix([
      ligne({ designation: "20 PENNE RIGATE LM CHEF 12 X 1KG", prixUnitaireUSD: 0.35, uniteParCarton: 12, prixCartonUSD: 42 }),
    ]);
    expect(e!.rapport).toBe(10);
    expect(e!.prixCartonAttendu).toBe(4.2);
    expect(e!.rapportEgalePoidsPaquet).toBe(false); // aucun conditionnement n'explique le ×10
  });

  it("qualifie l'écart quand le rapport vaut le poids du paquet (prix au gramme vs prix carton)", () => {
    const [e] = detecterEcartsPrix([
      ligne({ designation: "621 COUS COUS 12 X 500G", unite: "500 GR", prixUnitaireUSD: 0.004, uniteParCarton: 12, prixCartonUSD: 24 }),
    ]);
    expect(e!.rapport).toBe(500);
    expect(e!.rapportEgalePoidsPaquet).toBe(true);
  });

  it("ne signale rien quand le calcul tombe juste (aux arrondis près)", () => {
    expect(detecterEcartsPrix([ligne({ prixUnitaireUSD: 3, uniteParCarton: 30, prixCartonUSD: 90 })])).toHaveLength(0);
    expect(detecterEcartsPrix([ligne({ prixUnitaireUSD: 9.782608695652174, uniteParCarton: 1, prixCartonUSD: 9.782608695652174 })])).toHaveLength(0);
  });

  it("ne prétend rien quand une des trois valeurs manque", () => {
    expect(detecterEcartsPrix([ligne({ prixUnitaireUSD: 3, uniteParCarton: null, prixCartonUSD: 90 })])).toHaveLength(0);
  });
});

// ─── 2. Classeur synthétique : ancrage sur les libellés ──────────────────────

describe("ancrage sur les LIBELLÉS de la colonne B (classeur synthétique décalé)", () => {
  it("lit la sous-recette et le plat malgré 3 lignes d'écart entre les deux mises en page", () => {
    const wb = classeurSynthetique();

    const sauce = lireFiche(wb, "Sauce bolognaise").fiche!;
    expect(sauce.nom).toBe("Sauce bolognaise");
    expect(sauce.nbPortions).toBe(23);
    expect(sauce.tauxTVA).toBe(0.16);
    expect(sauce.coefficientMargeCible).toBe(3.5);
    expect(sauce.ingredients).toHaveLength(7); // les lignes de remplissage ne comptent pas

    const plat = lireFiche(wb, "Bolognaise").fiche!;
    expect(plat.nom).toBe("Bolognaise");
    expect(plat.categorie).toBe("Pâtes classiques");
    expect(plat.nbPortions).toBe(1);
    expect(plat.coefficientMargeCible).toBe(8);
    expect(plat.ingredients.map((i) => i.designation)).toEqual([
      "Sauce bolognaise",
      "20 PENNE RIGATE LM CHEF 12 X 1KG",
    ]);
  });

  it("localise le tableau des articles par son entête, pas par les colonnes R..X", () => {
    const cols = localiserColonnesArticles(LISTE_ARTICLES)!;
    expect(cols.ligneEntete).toBe(17);
    expect(cols.designation).toBe(XLSX.utils.decode_col("S"));
    expect(cols.barcode).toBe(XLSX.utils.decode_col("R"));
    // « Fournisseur » existe AUSSI en colonne B (liste des fournisseurs) : c'est bien X qui sort.
    expect(cols.fournisseur).toBe(XLSX.utils.decode_col("X"));
  });

  it("écarte la fausse ligne « Sauce bolognaise » de la liste des articles", () => {
    const res = analyserClasseur(classeurSynthetique());
    expect(res.faussesLignesArticles.map((a) => a.designation)).toEqual(["Sauce bolognaise"]);
    expect(res.articles.map((a) => a.designation)).not.toContain("Sauce bolognaise");
    expect(res.articles).toHaveLength(8);
  });

  it("déduit la sous-recette des références croisées et écrit son rendement en grammes", () => {
    const res = analyserClasseur(classeurSynthetique());
    expect(res.sousRecettes.map((f) => f.nom)).toEqual(["Sauce bolognaise"]);
    expect(res.plats.map((f) => f.nom)).toEqual(["Bolognaise"]);
    expect(res.sousRecettes[0]!.rendementQuantiteG).toBe(4600);
    expect(res.sousRecettes[0]!.rendementUniteSource).toBe("kg"); // lu « kg », stocké en g
  });

  it("rattache la Bolognaise à la sous-recette ET à l'article, sans rien deviner", () => {
    const res = analyserClasseur(classeurSynthetique());
    const lignes = res.lignes.filter((l) => l.fiche.nom === "Bolognaise");
    expect(lignes).toHaveLength(2);
    expect(lignes[0]!.rattachement.type).toBe("SOUS_RECETTE");
    expect(lignes[1]!.rattachement.type).toBe("ARTICLE");
    expect(res.nonRattaches).toHaveLength(0);
  });

  it("laisse NON RATTACHÉ un ingrédient inconnu au lieu de le rapprocher « au plus proche »", () => {
    const wb = classeurSynthetique();
    wb.Sheets["Bolognaise"] = feuille({
      B12: "FICHE TECHNIQUE", B16: "Bolognaise ",
      B18: "Nombre de portions :", C18: 1,
      B28: "Article", C28: "Unité ",
      B29: "Sauce bolognaisse", C29: "cl", D29: 200, // faute de frappe volontaire
      B34: "Total prix de revient HT",
    });
    const res = analyserClasseur(wb);
    expect(res.nonRattaches).toHaveLength(1);
    expect(res.nonRattaches[0]!.ingredient.designation).toBe("Sauce bolognaisse");
    expect(res.sousRecettes).toHaveLength(0); // plus personne ne cite la sauce : elle n'est plus sous-recette
  });

  it("signale l'écart de prix des pennes sans toucher au prix à l'unité importé", () => {
    const res = analyserClasseur(classeurSynthetique());
    expect(res.ecartsPrix).toHaveLength(1);
    expect(res.ecartsPrix[0]!.designation).toBe("20 PENNE RIGATE LM CHEF 12 X 1KG");
    const penne = res.articles.find((a) => a.designation.startsWith("20 PENNE"))!;
    expect(penne.prixUnitaireUSD).toBe(0.35); // valeur du classeur, telle quelle
    expect(penne.prixCartonUSD).toBe(42);
  });

  it("donne à la Bolognaise un coût complet de 2,54 $ (et non les 2,53 $ du classeur)", () => {
    const res = analyserClasseur(classeurSynthetique());
    const bolognaise = simulerCouts(res).find((s) => s.nom === "Bolognaise")!;
    expect(bolognaise.incomplet).toBe(false);
    // Le classeur affiche 2,53 $ parce qu'il arrondit ses lignes intermédiaires (2,46 + 0,07).
    // Le moteur reste en pleine précision jusqu'au centime final : 2,4706 + 0,07 = 2,54.
    // C'est l'écart documenté en tête de src/lib/fiches/cout.ts — l'import ne le « corrige » pas.
    expect(new Decimal(bolognaise.coutParPortion!).toDecimalPlaces(2).toNumber()).toBe(2.54);
  });
});

// ─── 3. Classeur RÉEL de la Direction (si présent sur la machine) ────────────

const classeurReelPresent = existsSync(CHEMIN_REEL);
if (!classeurReelPresent) {
  console.warn(`[import-fiches-plats.test] Classeur réel absent (${CHEMIN_REEL}) : bloc de vérification ignoré.`);
}

describe.skipIf(!classeurReelPresent)("classeur RÉEL « Fiche technique plats crash test.xlsx »", () => {
  const wb = classeurReelPresent
    ? XLSX.readFile(CHEMIN_REEL, { cellFormula: false, cellHTML: false, cellStyles: false, bookDeps: false })
    : ({ SheetNames: [], Sheets: {} } as XLSX.WorkBook);
  const res = analyserClasseur(wb);

  it("compte 109 lignes d'articles retenues, 108 distinctes, 5 fausses lignes écartées", () => {
    expect(res.nbLignesArticlesRetenues).toBe(109);
    expect(res.articles).toHaveLength(108); // « CAILLES » et « Cailles » sont le même article
    expect(res.faussesLignesArticles.map((a) => normaliserDesignation(a.designation)).sort()).toEqual([
      "bechamel", "bisque de cossas", "coulis de tomate", "jus de cuisson", "sauce bolognaise",
    ]);
  });

  it("compte 29 onglets de fiches : 5 sous-recettes + 24 plats", () => {
    expect(res.fiches).toHaveLength(29);
    expect(res.sousRecettes.map((f) => f.nom).sort()).toEqual([
      "Bisque de cossas", "Béchamel", "Coulis de tomate", "Jus de cuisson", "Sauce bolognaise",
    ]);
    expect(res.plats).toHaveLength(24);
  });

  it("la Bolognaise a 2 ingrédients : la Sauce bolognaise puis les pennes", () => {
    const lignes = res.lignes.filter((l) => l.fiche.onglet === "Bolognaise");
    expect(lignes).toHaveLength(2);
    expect(lignes[0]!.ingredient.designation.trim()).toBe("Sauce bolognaise");
    expect(lignes[0]!.rattachement.type).toBe("SOUS_RECETTE");
    expect(lignes[1]!.ingredient.designation).toBe("20 PENNE RIGATE LM CHEF 12 X 1KG");
    expect(lignes[1]!.rattachement.type).toBe("ARTICLE");
  });

  it("la Sauce bolognaise a 7 ingrédients et un rendement de 4600 g (jamais 4,6 kg)", () => {
    const sauce = res.sousRecettes.find((f) => f.nom === "Sauce bolognaise")!;
    expect(sauce.ingredients).toHaveLength(7);
    expect(sauce.rendementQuantiteG).toBe(4600);
    expect(sauce.nomBrut.trim()).toBe("Sauce bolognaise 4.6 kg");
  });

  it("AUCUNE sous-recette ne sort avec un rendement exprimé en kg", () => {
    for (const f of res.sousRecettes) {
      const unite = f.rendementQuantiteG === null ? null : "g";
      expect(unite === null || unite === "g").toBe(true);
    }
    expect(res.sousRecettes.filter((f) => f.rendementQuantiteG !== null).map((f) => f.rendementQuantiteG)).toEqual([4600, 1000]);
  });

  it("121 ingrédients au total, aucun non rattaché", () => {
    expect(res.lignes).toHaveLength(121);
    expect(res.nonRattaches).toEqual([]);
  });

  it("signale l'écart de prix connu sur les pennes (facteur 10), sans le corriger", () => {
    const penne = res.ecartsPrix.find((e) => e.designation.startsWith("20 PENNE RIGATE LM CHEF"))!;
    expect(penne.rapport).toBe(10);
    expect(penne.rapportEgalePoidsPaquet).toBe(false);
    expect(res.articles.find((a) => a.designation.startsWith("20 PENNE RIGATE LM CHEF"))!.prixUnitaireUSD).toBe(0.35);
  });

  it("chiffre les unités inconvertibles (question « emballage consommé à la pièce »)", () => {
    const lignes = res.unitesInconvertibles.flatMap((u) => u.occurrences);
    expect(lignes).toHaveLength(1);
    expect(res.unitesInconvertibles[0]!.uniteConsommation.trim()).toBe("500 GR");
    expect(res.unitesInconvertibles[0]!.article).toBe("15 SPAGHETTI 24 X 500G");
  });
});
