import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import * as XLSX from "xlsx";
import Decimal from "decimal.js";
import { calculerCout, type FicheCalc } from "@/lib/fiches/cout";
import { classeurSynthetique, feuille, LISTE_ARTICLES } from "./_fixture-classeur-fiches";
import {
  analyserClasseur,
  detecterEcartsPrix,
  detecterPrixInvraisemblables,
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
//  1. le classeur SYNTHÉTIQUE de `_fixture-classeur-fiches.ts`, volontairement DÉCALÉ d'un onglet
//     à l'autre — il prouve l'ancrage sur les libellés de la colonne B (une coordonnée codée en
//     dur échouerait) et il tourne partout, y compris sans le fichier de la Direction ;
//  2. le classeur RÉEL de la Direction quand il est présent sur la machine — il verrouille les
//     chiffres remontés dans le rapport (29 onglets, 121 ingrédients, 0 non rattaché…).
//
// Le chemin du classeur réel dépend de la machine. Son absence NE DOIT PAS passer inaperçue :
// elle est écrite dans le NOM du bloc de tests (donc dans le rapport de vitest), et
// `EXIGER_CLASSEUR_REEL=1` la transforme en échec — levier à activer sur une machine censée
// disposer du fichier (poste du contrôleur, CI qui monterait le classeur).
const CHEMIN_REEL = "/Users/sachatshiongo/Downloads/Tableurs/Fiche technique plats crash test.xlsx";

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

describe("detecterPrixInvraisemblables — la famille que « V×U ≠ W » ne peut PAS voir", () => {
  const art = (designation: string, unite: string, prix: number, ligne = 1): LigneArticle => ({
    ligne, designation, cle: normaliserDesignation(designation), codeBarresBrut: null, unite,
    uniteParCarton: null, uniteParCartonBrut: null, prixUnitaireUSD: prix, prixCartonUSD: null, fournisseur: null,
  });

  // Cas réel : « Sucre Blanc » à 0,00142 $ sous une unité « kg » (1,42 $ la tonne) alors que son
  // jumeau « Sucre Brun » est à 0,00138 $ le GRAMME. Une seule colonne de prix est en cause :
  // aucun rapprochement prix unitaire / prix carton ne peut le détecter.
  const catalogue = [
    art("Carottes", "kg", 4.58), art("Oignons", "kg", 2.26), art("Ail", "kg", 4.29),
    art("Tomates", "Kg", 4.22), art("Pommes", "kg", 2.2), art("MOZZARELLA", "Kg", 9.78),
    art("Sucre Brun", "g", 0.00138), art("Farine Fromant", "g", 0.001568),
  ];

  it("repère un prix mille fois trop bas pour l'unité déclarée", () => {
    const suspects = detecterPrixInvraisemblables([...catalogue, art("Sucre Blanc", "kg", 0.00142, 83)]);
    expect(suspects.map((s) => s.designation)).toEqual(["Sucre Blanc"]);
    expect(suspects[0]!.grandeur).toBe("kg");
    expect(suspects[0]!.prixRamene).toBe(0.00142);
    expect(suspects[0]!.rapport).toBeLessThan(0.01);
  });

  it("ne signale RIEN sur un catalogue cohérent, même mélangeant g et kg", () => {
    expect(detecterPrixInvraisemblables(catalogue)).toEqual([]);
  });

  it("ne compare pas les unités de comptage entre elles (deux « pièces » ne le sont pas)", () => {
    const suspects = detecterPrixInvraisemblables([
      ...catalogue,
      art("Tomates concentrées", "Pièce", 0.21),
      art("CAILLES", "Pièce", 3),
      art("Vin rouge", "Bouteille", 9),
    ]);
    expect(suspects).toEqual([]);
  });

  it("ramène un prix au paquet (« 500 GR ») au kilo avant de comparer", () => {
    const suspects = detecterPrixInvraisemblables([
      ...catalogue,
      art("15 SPAGHETTI 24 X 500G", "500 GR", 1.75), // 3,50 $/kg : normal
      art("621 COUS COUS 12 X 500G", "500 GR", 0.004, 46), // 0,008 $/kg : prix au gramme
    ]);
    expect(suspects.map((s) => s.designation)).toEqual(["621 COUS COUS 12 X 500G"]);
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

  it("lève une anomalie si une note s'insère dans le bloc de titre (le nom deviendrait la note)", () => {
    const wb = classeurSynthetique();
    wb.Sheets["Bolognaise"] = feuille({
      B12: "FICHE TECHNIQUE",
      B14: "Pâtes classiques",
      B15: "Bolognaise ",
      B16: "Recette revue par le chef en août", // note glissée SOUS le titre
      B18: "Nombre de portions :", C18: 1,
      B28: "Article", C28: "Unité ",
      B29: "20 PENNE RIGATE LM CHEF 12 X 1KG", C29: "Kg", D29: 0.2,
      B34: "Total prix de revient HT",
    });
    const res = analyserClasseur(wb);
    const anomalie = res.anomalies.find((a) => a.onglet === "Bolognaise");
    expect(anomalie?.raison).toContain("3 textes libres");
    // La règle « dernier texte » reste appliquée telle quelle — mais elle n'est plus silencieuse.
    expect(res.fiches.find((f) => f.onglet === "Bolognaise")!.textesEntete).toHaveLength(3);
  });

  it("n'invente aucune anomalie sur les blocs de titre normaux (1 ou 2 textes)", () => {
    const res = analyserClasseur(classeurSynthetique());
    expect(res.anomalies).toEqual([]);
    expect(res.fiches.map((f) => f.textesEntete.length).sort()).toEqual([2, 2]);
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

// L'état est porté par le NOM des tests, pas par un console.warn qui se perd dans le flot : le
// rapport de vitest dit lui-même si les chiffres réels ont été vérifiés ou non.
describe("chiffres du classeur RÉEL de la Direction", () => {
  it(
    classeurReelPresent
      ? "classeur présent : chiffres réels VÉRIFIÉS (voir le bloc suivant)"
      : "classeur ABSENT de cette machine : CHIFFRES RÉELS NON VÉRIFIÉS (109/108/5, 29 onglets, 121 ingrédients) — poser EXIGER_CLASSEUR_REEL=1 pour en faire un échec",
    () => {
      if (process.env.EXIGER_CLASSEUR_REEL === "1") {
        expect(classeurReelPresent, `Classeur réel introuvable : ${CHEMIN_REEL}`).toBe(true);
      }
      expect(typeof classeurReelPresent).toBe("boolean");
    },
  );
});

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

  it("aucune unité inconvertible : « 500 GR » consommé en « 500 GR » est la MÊME unité (facteur 1)", () => {
    // Avant le 2026-08-16, `facteur` renvoyait à tort `null` quand source et cible étaient
    // strictement identiques mais inconnues du système (ex. « 500 GR »), et cette ligne — « 15
    // SPAGHETTI 24 X 500G » consommé en « 500 GR » — était signalée ici comme inconvertible.
    // C'était faux : une unité rapportée à elle-même vaut toujours 1, par construction. Corrigé
    // dans conversion.ts ; la liste est donc désormais vide sur ce classeur.
    const lignes = res.unitesInconvertibles.flatMap((u) => u.occurrences);
    expect(lignes).toHaveLength(0);
  });

  it("attrape le « Sucre Blanc » au gramme sous une unité kg, invisible pour le contrôle V×U", () => {
    const sucre = res.prixInvraisemblables.find((p) => p.designation.trim() === "Sucre Blanc");
    expect(sucre).toBeDefined();
    expect(sucre!.unite).toBe("kg");
    expect(sucre!.prixUnitaire).toBeCloseTo(0.00142, 6);
    expect(sucre!.rapport).toBeLessThan(0.01); // des ordres de grandeur sous la médiane des pairs
    // Et il n'est PAS dans les écarts V×U : la cellule « quantité par paquet » contient du texte.
    expect(res.ecartsPrix.some((e) => e.designation.trim() === "Sucre Blanc")).toBe(false);
  });

  it("la « Maizena blanc » sans quantité empêche désormais la Bisque de passer pour chiffrée", () => {
    const bisque = simulerCouts(res).find((s) => s.nom === "Bisque de cossas")!;
    expect(bisque.incomplet).toBe(true);
    expect(bisque.motifs).toContain("Maizena blanc");
    expect(res.quantitesAbsentes.map((l) => l.ingredient.designation)).toEqual(["Maizena blanc"]);
  });

  it("les arrondis de schéma ne déplacent aucune fiche de plus d'un centime et demi", () => {
    const brut = simulerCouts(res);
    const arrondi = simulerCouts(res, { arrondiSchema: true });
    const ecarts = brut
      .map((b) => {
        const a = arrondi.find((x) => x.nom === b.nom);
        return b.coutTotal && a?.coutTotal ? a.coutTotal.minus(b.coutTotal).abs() : null;
      })
      .filter((d): d is Decimal => d !== null);
    expect(ecarts.length).toBeGreaterThan(0);
    const pire = ecarts.reduce((m, d) => (d.greaterThan(m) ? d : m));
    expect(pire.lessThan(0.015)).toBe(true); // c'est ce qui justifie de NE PAS migrer le schéma
  });

  it("aucun bloc de titre du classeur réel ne dépasse 2 textes libres", () => {
    expect(res.fiches.every((f) => f.textesEntete.length <= 2)).toBe(true);
    expect(res.anomalies.filter((a) => a.raison.includes("textes libres"))).toEqual([]);
  });
});
