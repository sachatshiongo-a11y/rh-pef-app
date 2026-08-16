import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import { calculerCout, type FicheCalc, type IngredientCalc } from "@/lib/fiches/cout";

// ─── Fabriques de fiches de test ─────────────────────────────────────────────

const CTX_VIDE = { fiches: new Map<string, FicheCalc>() };

let compteur = 0;
function id(): string {
  compteur += 1;
  return `f${compteur}`;
}

/** Fiche « plat final » : 1 portion, TVA 16 %, pas de rendement. */
function fiche(ingredients: IngredientCalc[], extras: Partial<FicheCalc> = {}): FicheCalc {
  return {
    id: id(),
    nom: "Plat de test",
    nbPortions: 1,
    tauxTVA: 0.16,
    estSousRecette: false,
    ingredients,
    ...extras,
  };
}

/** Fiche « sous-recette » : rendement en grammes (densité 1, cf. spec §12.1). */
function ficheSousRecette(extras: Partial<FicheCalc> & { rendementQuantite: number }): FicheCalc {
  return {
    id: id(),
    nom: "Sous-recette de test",
    nbPortions: 1,
    tauxTVA: 0.16,
    estSousRecette: true,
    rendementUnite: "g",
    ingredients: [],
    ...extras,
  };
}

function mapAvec(...fiches: FicheCalc[]) {
  return { fiches: new Map(fiches.map((f) => [f.id, f])) };
}

/**
 * Ingrédients de la Sauce bolognaise du classeur : total EXACT 56,8237 $ HT.
 * Ils exercent au passage les trois conversions (g→kg, cl→L, pièce→pièce).
 */
const INGREDIENTS_SAUCE: IngredientCalc[] = [
  { nom: "Viande hachée", quantite: 2.5, unite: "kg", article: { prixUnitaireUSD: 14.35, unite: "kg" } }, // 35,875
  { nom: "Tomates concassées", quantite: 3000, unite: "g", article: { prixUnitaireUSD: 2.99, unite: "kg" } }, // 8,97
  { nom: "Oignons", quantite: 1.2, unite: "kg", article: { prixUnitaireUSD: 1.45, unite: "kg" } }, // 1,74
  { nom: "Huile végétale", quantite: 50, unite: "cl", article: { prixUnitaireUSD: 4.2, unite: "L" } }, // 2,10
  { nom: "Ail", quantite: 200, unite: "g", article: { prixUnitaireUSD: 6.5, unite: "kg" } }, // 1,30
  { nom: "Concentré de tomate", quantite: 3, unite: "pièce", article: { prixUnitaireUSD: 1.9, unite: "pièce" } }, // 5,70
  { nom: "Sel", quantite: 0.5, unite: "kg", article: { prixUnitaireUSD: 0.8, unite: "kg" } }, // 0,40
  // Ligne de calage sur le golden du classeur (56,8237) : 56,085 + 0,7387.
  { nom: "Épices", quantite: 0.1, unite: "kg", article: { prixUnitaireUSD: 7.387, unite: "kg" } }, // 0,7387
];

// ─── T1 : ingrédient article + conversion de masse ───────────────────────────

describe("coût d'un ingrédient article", () => {
  it("coût ingrédient article", () => {
    const r = calculerCout(
      fiche([{ quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 8.07, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.coutTotal.toFixed(2)).toBe("1.61"); // 1,614 → 1,61
    expect(r.incomplet).toBe(false);
  });

  it("conserve la pleine précision, sans arrondi intermédiaire au centime", () => {
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "g", article: { prixUnitaireUSD: 8.07, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.coutTotal.toString()).toBe("0.00807"); // et surtout PAS 0,01
    expect(r.coutTotal).toBeInstanceOf(Decimal);
  });

  it("convertit le prix dans le BON sens : 3 000 g d'un article à 2,99 $/kg = 8,97 $", () => {
    const r = calculerCout(
      fiche([{ quantite: 3000, unite: "g", article: { prixUnitaireUSD: 2.99, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.coutTotal.toString()).toBe("8.97"); // pas 8 970 (facteur inversé)
  });

  it("accepte un prix en Decimal (valeur Prisma) sans passer par le flottant", () => {
    const r = calculerCout(
      fiche([
        { quantite: new Decimal("0.2"), unite: "kg", article: { prixUnitaireUSD: new Decimal("8.07"), unite: "kg" } },
      ]),
      CTX_VIDE,
    );
    expect(r.coutTotal.toString()).toBe("1.614");
  });

  it("unité-emballage « 500 GR » : le prix est celui du paquet, le poids vient de l'unité", () => {
    const r = calculerCout(
      fiche([{ quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 1.75, unite: "500 GR" } }]),
      CTX_VIDE,
    );
    // 1,75 $ le paquet de 0,5 kg = 3,50 $/kg → 0,2 kg = 0,70 $
    expect(r.coutTotal.toString()).toBe("0.7");
    expect(r.incomplet).toBe(false);
  });

  it("le coût par portion divise le total par le nombre de portions", () => {
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: 10, unite: "kg" } }], { nbPortions: 4 }),
      CTX_VIDE,
    );
    expect(r.coutTotal.toString()).toBe("10");
    expect(r.coutParPortion.toString()).toBe("2.5");
  });

  it("le coût par portion n'est PAS arrondi avant les calculs de marge", () => {
    // 10 $ / 3 portions = 3,33333… ; × 8 = 26,6666… → 26,67.
    // Un arrondi intermédiaire à 3,33 donnerait 26,64 : un centime perdu à chaque plat.
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: 10, unite: "kg" } }], {
        nbPortions: 3,
        coefficientMargeCible: 8,
      }),
      CTX_VIDE,
    );
    expect(r.coutParPortion.toFixed(4)).toBe("3.3333");
    expect(r.prixVenteHT).toBe(26.67);
    expect(r.prixConseille).toEqual({ ht: 26.67, ttc: 30.93, minorant: false }); // 26,66666… × 1,16 = 30,9333…
  });
});

// ─── T2 : sous-recette au gramme (le piège du ×10) ───────────────────────────

describe("coût d'un ingrédient sous-recette", () => {
  it("sous-recette au gramme (pas de conversion volume)", () => {
    const sauce = ficheSousRecette({ rendementQuantite: 4600, ingredients: INGREDIENTS_SAUCE });
    const plat = fiche([{ nom: "Sauce bolognaise", quantite: 200, unite: "g", sousFicheId: sauce.id }]);
    expect(calculerCout(plat, mapAvec(sauce)).coutTotal.toFixed(4)).toBe("2.4706");
  });

  it("le total de la sauce vaut 56,8237 $ et 2,47 $ la portion (23 portions)", () => {
    const sauce = ficheSousRecette({
      rendementQuantite: 4600,
      ingredients: INGREDIENTS_SAUCE,
      nbPortions: 23,
    });
    const r = calculerCout(sauce, CTX_VIDE);
    expect(r.coutTotal.toString()).toBe("56.8237");
    expect(r.coutParPortion.toFixed(2)).toBe("2.47");
    expect(r.incomplet).toBe(false);
  });

  it("une consommation écrite « cl » vaut la même chose qu'en « g » (densité 1, jamais ×10)", () => {
    const sauce = ficheSousRecette({ rendementQuantite: 4600, ingredients: INGREDIENTS_SAUCE });
    const enGrammes = fiche([{ quantite: 200, unite: "g", sousFicheId: sauce.id }]);
    const enCl = fiche([{ quantite: 200, unite: "cl", sousFicheId: sauce.id }]);
    expect(calculerCout(enCl, mapAvec(sauce)).coutTotal.toString()).toBe(
      calculerCout(enGrammes, mapAvec(sauce)).coutTotal.toString(),
    );
  });

  it("accepte la sous-fiche fournie en ligne (sans passer par la map)", () => {
    const sauce = ficheSousRecette({ rendementQuantite: 4600, ingredients: INGREDIENTS_SAUCE });
    const plat = fiche([{ quantite: 200, unite: "g", sousFiche: sauce }]);
    expect(calculerCout(plat, CTX_VIDE).coutTotal.toFixed(4)).toBe("2.4706");
  });

  it("sous-recette sans rendement : coût indéterminé, jamais 0 compté", () => {
    const sauce = ficheSousRecette({ rendementQuantite: 4600, ingredients: INGREDIENTS_SAUCE });
    const sansRendement: FicheCalc = { ...sauce, rendementQuantite: null };
    const plat = fiche([{ nom: "Sauce", quantite: 200, unite: "g", sousFicheId: sansRendement.id }]);
    const r = calculerCout(plat, mapAvec(sansRendement));
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Sauce"]);
    expect(r.coutTotal.toNumber()).toBe(0);
  });

  it("rendement en kg consommé en g : incohérent, jamais un coût 1000 fois trop élevé", () => {
    // Saisir « 4,6 / kg » pour une sauce de 4,6 kg est naturel. Sans garde-fou, 200 g de cette
    // sauce coûteraient 200 × (35,875 / 4,6) = 1 559,78 $ sans que rien ne le signale.
    const sauce = ficheSousRecette({
      nom: "Sauce",
      rendementQuantite: 4.6,
      rendementUnite: "kg",
      ingredients: [{ nom: "Viande", quantite: 2.5, unite: "kg", article: { prixUnitaireUSD: 14.35, unite: "kg" } }],
    });
    const plat = fiche([{ nom: "Sauce", quantite: 200, unite: "g", sousFicheId: sauce.id }]);
    const r = calculerCout(plat, mapAvec(sauce));
    expect(r.incomplet).toBe(true);
    expect(r.coutTotal.toNumber()).toBe(0);
    expect(r.ingredientsSansPrix).toEqual(["Sauce"]);
    expect(r.lignes[0]!.motif).toBe("UNITE_RENDEMENT_INCOHERENTE");
    expect(r.lignes[0]!.cout).toBeNull();
  });

  it("rendement en kg consommé en « cl » : incohérent aussi (rendement hors unité de base)", () => {
    const sauce = ficheSousRecette({
      nom: "Sauce",
      rendementQuantite: 4.6,
      rendementUnite: "kg",
      ingredients: [{ nom: "Viande", quantite: 2.5, unite: "kg", article: { prixUnitaireUSD: 14.35, unite: "kg" } }],
    });
    const plat = fiche([{ nom: "Sauce", quantite: 200, unite: "cl", sousFicheId: sauce.id }]);
    const r = calculerCout(plat, mapAvec(sauce));
    expect(r.lignes[0]!.motif).toBe("UNITE_RENDEMENT_INCOHERENTE");
    expect(r.incomplet).toBe(true);
  });

  it("le garde-fou de rendement ne casse ni « cl = gramme » ni les unités identiques", () => {
    const sauce = ficheSousRecette({ rendementQuantite: 4600, rendementUnite: "g", ingredients: INGREDIENTS_SAUCE });
    // « cl » face à un rendement en g : grandeurs non comparables → densité 1, aucun blocage.
    expect(
      calculerCout(fiche([{ quantite: 200, unite: "cl", sousFicheId: sauce.id }]), mapAvec(sauce)).incomplet,
    ).toBe(false);
    // kg face à un rendement en kg : même unité, facteur 1 → aucun blocage, calcul correct.
    const sauceKg = ficheSousRecette({ rendementQuantite: 4.6, rendementUnite: "kg", ingredients: INGREDIENTS_SAUCE });
    const r = calculerCout(fiche([{ quantite: 0.2, unite: "kg", sousFicheId: sauceKg.id }]), mapAvec(sauceKg));
    expect(r.incomplet).toBe(false);
    expect(r.coutTotal.toFixed(4)).toBe("2.4706"); // 56,8237 / 4,6 kg × 0,2 kg
  });

  it("rendement en portions consommé en grammes : incommensurable, jamais divisé en silence", () => {
    // « portion » est une valeur légitime de rendementUnite (spec §4), mais diviser des grammes
    // par des portions ne veut rien dire : c'est une incommensurabilité, pas un facteur d'échelle.
    const base = ficheSousRecette({
      nom: "Base",
      rendementQuantite: 12,
      rendementUnite: "portion",
      ingredients: [{ nom: "Viande", quantite: 2, unite: "kg", article: { prixUnitaireUSD: 12, unite: "kg" } }],
    });
    const plat = fiche([{ nom: "Base", quantite: 200, unite: "g", sousFicheId: base.id }]);
    const r = calculerCout(plat, mapAvec(base));
    expect(r.lignes[0]!.motif).toBe("UNITE_RENDEMENT_INCOHERENTE");
    expect(r.lignes[0]!.cout).toBeNull();
    expect(r.incomplet).toBe(true);
    expect(r.coutTotal.toNumber()).toBe(0);
  });

  it("rendement en portions consommé en portions : cas légitime, calcul normal", () => {
    const base = ficheSousRecette({
      nom: "Base",
      rendementQuantite: 12,
      rendementUnite: "portion",
      ingredients: [{ nom: "Viande", quantite: 2, unite: "kg", article: { prixUnitaireUSD: 12, unite: "kg" } }],
    });
    const plat = fiche([{ nom: "Base", quantite: 2, unite: "Portion", sousFicheId: base.id }]);
    const r = calculerCout(plat, mapAvec(base));
    expect(r.incomplet).toBe(false); // la casse ne doit pas faire échouer la comparaison
    expect(r.coutTotal.toString()).toBe("4"); // 24 $ / 12 portions × 2 portions
  });

  it("rendement en pièces consommé en grammes : incommensurable aussi", () => {
    const base = ficheSousRecette({
      nom: "Base",
      rendementQuantite: 10,
      rendementUnite: "pièce",
      ingredients: [{ nom: "Viande", quantite: 2, unite: "kg", article: { prixUnitaireUSD: 12, unite: "kg" } }],
    });
    const plat = fiche([{ nom: "Base", quantite: 200, unite: "g", sousFicheId: base.id }]);
    expect(calculerCout(plat, mapAvec(base)).lignes[0]!.motif).toBe("UNITE_RENDEMENT_INCOHERENTE");
  });

  it("sous-recette dont aucune ligne n'est valorisée : coût indéterminé, pas « 0,00 $ »", () => {
    const muette = ficheSousRecette({ nom: "Sauce muette", rendementQuantite: 1000, ingredients: [] });
    const plat = fiche([{ nom: "Sauce muette", quantite: 200, unite: "g", sousFicheId: muette.id }]);
    const r = calculerCout(plat, mapAvec(muette));
    expect(r.lignes[0]!.cout).toBeNull();
    expect(r.lignes[0]!.motif).toBe("COUT_INDETERMINE");
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Sauce muette"]);
    expect(r.coutTotal.toNumber()).toBe(0);
  });

  it("sous-recette dont tous les ingrédients sont sans prix : coût indéterminé", () => {
    const sauce = ficheSousRecette({
      nom: "Sauce",
      rendementQuantite: 1000,
      ingredients: [{ nom: "Tomate", quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } }],
    });
    const plat = fiche([{ nom: "Sauce", quantite: 200, unite: "g", sousFicheId: sauce.id }]);
    const r = calculerCout(plat, mapAvec(sauce));
    expect(r.lignes[0]!.cout).toBeNull();
    expect(r.lignes[0]!.motif).toBe("COUT_INDETERMINE");
    expect(r.ingredientsSansPrix).toEqual(["Sauce › Tomate"]);
    expect(r.incomplet).toBe(true);
  });

  it("sous-fiche introuvable dans le contexte : coût indéterminé, pas d'exception", () => {
    const plat = fiche([{ nom: "Sauce fantôme", quantite: 200, unite: "g", sousFicheId: "inconnue" }]);
    const r = calculerCout(plat, CTX_VIDE);
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Sauce fantôme"]);
  });

  it("propage l'incomplétude d'une sous-recette au plat parent", () => {
    const sauce = ficheSousRecette({
      nom: "Sauce",
      rendementQuantite: 1000,
      ingredients: [
        { nom: "Tomate", quantite: 1, unite: "kg", article: { prixUnitaireUSD: 2, unite: "kg" } },
        { nom: "Basilic", quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } },
      ],
    });
    const plat = fiche([{ nom: "Sauce", quantite: 500, unite: "g", sousFicheId: sauce.id }]);
    const r = calculerCout(plat, mapAvec(sauce));
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Sauce › Basilic"]);
    // Le coût partiel reste calculé : 2 $ / 1000 g × 500 g = 1 $ (annoncé partiel).
    expect(r.coutTotal.toString()).toBe("1");
  });
});

// ─── T3 : golden Bolognaise ──────────────────────────────────────────────────

describe("golden du classeur", () => {
  it("golden Bolognaise", () => {
    const SAUCE = ficheSousRecette({
      nom: "Sauce bolognaise 4.6 kg",
      rendementQuantite: 4600,
      ingredients: INGREDIENTS_SAUCE,
      nbPortions: 23,
    });
    const BOLOGNAISE = fiche(
      [
        // Le classeur écrit « 200 cl » : c'est 200 g de sauce (densité 1).
        { nom: "Sauce bolognaise", quantite: 200, unite: "cl", sousFicheId: SAUCE.id },
        { nom: "Penne", quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 0.35, unite: "kg" } },
      ],
      { nom: "Bolognaise", nbPortions: 1 },
    );
    const MAP_AVEC_SAUCE = mapAvec(SAUCE);

    const r = calculerCout(BOLOGNAISE, MAP_AVEC_SAUCE);
    expect(r.coutParPortion.toFixed(2)).toBe("2.54"); // 2,5405956… — surtout pas 2,53
    expect(r.incomplet).toBe(false);
    expect(r.cycle).toBe(false);
  });
});

// ─── T4 : marge, taux de marque, ratio matière ───────────────────────────────

/** Fiche dont le coût par portion vaut exactement `coutParPortion`. */
function ficheAvecPrix(o: {
  coutParPortion: number;
  coefficient?: number;
  prixVenteTTC?: number;
  tauxTVA: number;
}): FicheCalc {
  return fiche([{ nom: "Matière", quantite: 1, unite: "kg", article: { prixUnitaireUSD: o.coutParPortion, unite: "kg" } }], {
    nbPortions: 1,
    tauxTVA: o.tauxTVA,
    coefficientMargeCible: o.coefficient ?? null,
    prixVenteTTC: o.prixVenteTTC ?? null,
  });
}

describe("marge et prix", () => {
  it("marge et taux de marque", () => {
    const r = calculerCout(ficheAvecPrix({ coutParPortion: 2.53, coefficient: 8, tauxTVA: 0.16 }), CTX_VIDE);
    expect(r.prixVenteHT).toBe(20.24);
    expect(r.margeBrute).toBe(17.71);
    expect(r.prixVenteTTC).toBe(23.48);
    expect(r.tauxMarque).toBeCloseTo(0.875, 3);
    expect(r.ratioMatiere).toBeCloseTo(0.125, 3);
    expect(r.coefficient).toBeCloseTo(8, 6);
    expect(r.prixConseille).toEqual({ ht: 20.24, ttc: 23.48, minorant: false });
    // Aucun prix n'a été décidé : ce 20,24 est une CIBLE, l'écran doit le dire.
    expect(r.prixEstConseille).toBe(true);
  });

  it("prix de vente TTC saisi : le HT en est dérivé (TVA 16 %)", () => {
    const r = calculerCout(ficheAvecPrix({ coutParPortion: 2.53, prixVenteTTC: 23.48, tauxTVA: 0.16 }), CTX_VIDE);
    expect(r.prixVenteTTC).toBe(23.48);
    expect(r.prixVenteHT).toBe(20.24); // 23,48 / 1,16 = 20,2413…
    expect(r.margeBrute).toBe(17.71);
    expect(r.coefficient).toBeCloseTo(8.0005, 3); // 8,00054518… (le TTC arrondi ne retombe pas pile sur 8)
    expect(r.prixEstConseille).toBe(false); // prix DÉCIDÉ : marge constatée, pas cible
  });

  it("sans prix ni coefficient : aucune marge inventée", () => {
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: 2.53, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.prixVenteHT).toBeNull();
    expect(r.prixVenteTTC).toBeNull();
    expect(r.coefficient).toBeNull();
    expect(r.tauxMarque).toBeNull();
    expect(r.ratioMatiere).toBeNull();
    expect(r.margeBrute).toBeNull();
    expect(r.prixConseille).toBeNull();
    expect(r.prixEstConseille).toBe(false);
  });

  it("coût par portion nul : ni coefficient ni prix conseillé (pas de division par zéro)", () => {
    const r = calculerCout(
      fiche([{ nom: "Sans prix", quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } }], {
        coefficientMargeCible: 8,
      }),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.coefficient).toBeNull();
    expect(r.prixConseille).toBeNull();
    expect(r.prixVenteHT).toBeNull();
  });

  // Taux de marge (margeBrute / coutParPortion, « ce qu'on ajoute au coût ») ≠ taux de marque
  // (margeBrute / prixVenteHT, « quelle part du prix de vente »). T4 : coût 2,53, coefficient 8,
  // PV HT 20,24, marge 17,71 → taux de marge = 17,71 / 2,53 = 7 exactement (700 %).
  it("taux de marge (T4) : distinct du taux de marque, vaut exactement 7", () => {
    const r = calculerCout(ficheAvecPrix({ coutParPortion: 2.53, coefficient: 8, tauxTVA: 0.16 }), CTX_VIDE);
    expect(r.margeBrute).toBe(17.71);
    expect(r.tauxMarge).toBeCloseTo(7, 6);
    expect(r.tauxMarque).toBeCloseTo(0.875, 3);
    // Les deux taux ne doivent jamais coïncider — sinon l'un des deux est mal câblé.
    expect(r.tauxMarge).not.toBeCloseTo(r.tauxMarque!, 3);
  });

  it("relation de cohérence : taux de marge = coefficient − 1", () => {
    const r = calculerCout(ficheAvecPrix({ coutParPortion: 2.53, coefficient: 8, tauxTVA: 0.16 }), CTX_VIDE);
    expect(r.tauxMarge).toBeCloseTo(r.coefficient! - 1, 9);
  });

  it("taux de marge : null quand le coût par portion n'est pas exploitable", () => {
    const r = calculerCout(
      fiche([{ nom: "Sans prix", quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } }], {
        coefficientMargeCible: 8,
      }),
      CTX_VIDE,
    );
    expect(r.tauxMarge).toBeNull();
  });

  it("taux de marge : null quand la marge n'est pas connue (aucun prix ni coefficient)", () => {
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: 2.53, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.tauxMarge).toBeNull();
  });
});

// ─── T5 : coût incomplet annoncé ─────────────────────────────────────────────

describe("coût incomplet annoncé", () => {
  it("coût incomplet annoncé si prix null", () => {
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix.length).toBe(1);
    expect(r.coutTotal.toNumber()).toBe(0);
  });

  it("prix à 0 en base : traité comme non renseigné, jamais comme gratuit", () => {
    // Le zéro discret : sans ce garde-fou, un plat non renseigné passe pour le plus rentable
    // du catalogue (coût 0,07 $, marge maximale, prix conseillé 0,56 $).
    const r = calculerCout(
      fiche(
        [
          { nom: "Bœuf", quantite: 1, unite: "kg", article: { prixUnitaireUSD: 0, unite: "kg" } },
          { nom: "Penne", quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 0.35, unite: "kg" } },
        ],
        { coefficientMargeCible: 8 },
      ),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Bœuf"]);
    expect(r.lignes[0]!.motif).toBe("PRIX_NUL");
    expect(r.lignes[0]!.cout).toBeNull();
    expect(r.coutTotal.toString()).toBe("0.07"); // coût partiel, ANNONCÉ comme tel
    // Le prix conseillé qui en découle n'est PAS un prix : c'est un plancher. Avec le bœuf à
    // 6 $/kg, le coût réel serait 6,07 $ et le prix conseillé 48,56 $ — facteur 87.
    expect(r.prixConseille).toEqual({ ht: 0.56, ttc: 0.65, minorant: true });
  });

  it("le prix conseillé d'un coût complet n'est pas un minorant", () => {
    const r = calculerCout(
      fiche([{ nom: "Bœuf", quantite: 1, unite: "kg", article: { prixUnitaireUSD: 6, unite: "kg" } }], {
        coefficientMargeCible: 8,
      }),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(false);
    expect(r.prixConseille).toEqual({ ht: 48, ttc: 55.68, minorant: false });
  });

  it("prix négatif en base : traité comme non renseigné", () => {
    const r = calculerCout(
      fiche([{ nom: "Bœuf", quantite: 1, unite: "kg", article: { prixUnitaireUSD: -3, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.lignes[0]!.motif).toBe("PRIX_NUL");
    expect(r.coutTotal.toNumber()).toBe(0);
  });

  it("unité inconnue (texte libre du catalogue) : sans prix, jamais un facteur supposé", () => {
    const r = calculerCout(
      fiche([{ nom: "Farine", quantite: 1, unite: "kg", article: { prixUnitaireUSD: 3, unite: "sachet de 5" } }]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Farine"]);
    expect(r.coutTotal.toNumber()).toBe(0);
  });

  it("unités incompatibles (pièce consommée au gramme) : sans prix", () => {
    const r = calculerCout(
      fiche([{ nom: "Œuf", quantite: 50, unite: "g", article: { prixUnitaireUSD: 0.25, unite: "pièce" } }]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Œuf"]);
  });

  it("quantité absente ou négative : sans prix, jamais un coût de 0 « valide »", () => {
    const r = calculerCout(
      fiche([
        // @ts-expect-error donnée abîmée : la quantité doit être signalée, pas comptée 0
        { nom: "Quantité manquante", quantite: null, unite: "kg", article: { prixUnitaireUSD: 5, unite: "kg" } },
        { nom: "Quantité négative", quantite: -2, unite: "kg", article: { prixUnitaireUSD: 5, unite: "kg" } },
      ]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Quantité manquante", "Quantité négative"]);
    expect(r.coutTotal.toNumber()).toBe(0);
    expect(r.lignes.map((l) => l.motif)).toEqual(["QUANTITE_INVALIDE", "QUANTITE_INVALIDE"]);
  });

  it("quantité à 0 : NON RENSEIGNÉE, pas « ne coûte rien » — la fiche ne peut pas passer complète", () => {
    // Cas réel du classeur de la Direction : « Maizena blanc » dans la Bisque de cossas, colonne
    // « Unités nécessaires » vide. Comptée 0, elle sous-évaluait la fiche de 4,56 $ (+8,53 %)
    // SANS que rien ne le dise. La saisie de l'app interdit déjà toute quantité <= 0.
    const r = calculerCout(
      fiche([
        { nom: "Penne", quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 0.35, unite: "kg" } },
        { nom: "Maizena blanc", quantite: 0, unite: "Paquet", article: { prixUnitaireUSD: 4.56, unite: "Paquet" } },
      ]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Maizena blanc"]);
    expect(r.lignes.map((l) => l.motif)).toEqual([null, "QUANTITE_ABSENTE"]);
    expect(r.lignes[1]!.cout).toBeNull(); // jamais 0,00 $ affiché comme un montant
    expect(r.coutTotal.toNumber()).toBe(0.07); // les autres lignes restent valorisées
  });

  it("une sous-recette à quantité 0 est indéterminée elle aussi (pas de coût 0 hérité)", () => {
    const sauce: FicheCalc = {
      id: "sauce", nom: "Sauce", nbPortions: 1, tauxTVA: 0.16, estSousRecette: true,
      rendementQuantite: 4600, rendementUnite: "g",
      ingredients: [{ nom: "Viande", quantite: 2.2, unite: "kg", article: { prixUnitaireUSD: 8.07, unite: "kg" } }],
    };
    const r = calculerCout(fiche([{ nom: "Sauce", quantite: 0, unite: "cl", sousFicheId: "sauce" }]), mapAvec(sauce));
    expect(r.incomplet).toBe(true);
    expect(r.lignes[0]!.motif).toBe("QUANTITE_ABSENTE");
  });

  it("ingrédient sans article ni sous-fiche : sans prix", () => {
    const r = calculerCout(fiche([{ nom: "Ligne vide", quantite: 1, unite: "kg" }]), CTX_VIDE);
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Ligne vide"]);
  });

  it("le coût partiel additionne les lignes valorisées et annonce les autres", () => {
    const r = calculerCout(
      fiche([
        { nom: "Penne", quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 0.35, unite: "kg" } },
        { nom: "Truffe", quantite: 0.01, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } },
      ]),
      CTX_VIDE,
    );
    expect(r.coutTotal.toString()).toBe("0.07");
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Truffe"]);
  });

  it("nomme les ingrédients sans prix par défaut quand ils n'ont pas de nom", () => {
    const r = calculerCout(
      fiche([
        { quantite: 1, unite: "kg", article: { prixUnitaireUSD: 1, unite: "kg" } },
        { quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } },
      ]),
      CTX_VIDE,
    );
    expect(r.ingredientsSansPrix).toEqual(["Ingrédient n°2"]);
  });
});

// ─── Cycles ──────────────────────────────────────────────────────────────────

describe("détection de cycle", () => {
  it(
    "détecte un cycle",
    () => {
      // A contient B, B contient A → coût indéterminé, pas de récursion infinie.
      const A: FicheCalc = fiche([]);
      const B: FicheCalc = fiche([]);
      A.nom = "A";
      B.nom = "B";
      A.ingredients = [{ nom: "B", quantite: 100, unite: "g", sousFicheId: B.id }];
      B.ingredients = [{ nom: "A", quantite: 100, unite: "g", sousFicheId: A.id }];
      A.rendementQuantite = 1000;
      B.rendementQuantite = 1000;

      let r: ReturnType<typeof calculerCout> | undefined;
      expect(() => {
        r = calculerCout(A, mapAvec(A, B));
      }).not.toThrow(); // un débordement de pile lèverait une RangeError
      expect(r).toBeDefined();
      expect(r!.cycle).toBe(true);
      expect(r!.incomplet).toBe(true);
      expect(r!.coutTotal.toNumber()).toBe(0);
      // La ligne ne doit pas s'afficher « 0,00 $ » : son coût est INDÉTERMINÉ.
      expect(r!.lignes[0]!.cout).toBeNull();
      expect(r!.lignes[0]!.motif).toBe("CYCLE");
    },
    2000, // si la récursion bouclait sans déborder, le test échouerait par timeout
  );

  it(
    "un cycle PARTIELLEMENT valorisé reste indéterminé (pas un minorant)",
    () => {
      // La sous-recette S a un vrai coût (tomate 1 $) ET un retour vers le plat parent.
      // Un coût qui dépend de lui-même n'est pas un minorant : c'est une valeur non définie.
      // On ne compte donc PAS le 1 $ dans le total du plat.
      const plat: FicheCalc = fiche([], { nom: "Plat", rendementQuantite: 1000, rendementUnite: "g" });
      const S: FicheCalc = ficheSousRecette({
        nom: "S",
        rendementQuantite: 1000,
        ingredients: [
          { nom: "Tomate", quantite: 1, unite: "kg", article: { prixUnitaireUSD: 1, unite: "kg" } },
          { nom: "Plat (retour)", quantite: 100, unite: "g", sousFicheId: plat.id },
        ],
      });
      plat.ingredients = [{ nom: "S", quantite: 500, unite: "g", sousFicheId: S.id }];

      let r: ReturnType<typeof calculerCout> | undefined;
      expect(() => {
        r = calculerCout(plat, mapAvec(plat, S));
      }).not.toThrow();
      expect(r!.cycle).toBe(true);
      expect(r!.incomplet).toBe(true);
      expect(r!.lignes[0]!.cout).toBeNull();
      expect(r!.lignes[0]!.motif).toBe("CYCLE");
      expect(r!.coutTotal.toNumber()).toBe(0); // surtout pas 0,50 $ « au moins »
      expect(r!.ingredientsSansPrix).toEqual(["S › Plat (retour)"]);
    },
    2000,
  );

  it(
    "détecte une fiche qui se contient elle-même",
    () => {
      const A: FicheCalc = fiche([], { nom: "A", rendementQuantite: 1000 });
      A.ingredients = [{ nom: "A (elle-même)", quantite: 100, unite: "g", sousFicheId: A.id }];
      const r = calculerCout(A, mapAvec(A));
      expect(r.cycle).toBe(true);
      expect(r.incomplet).toBe(true);
    },
    2000,
  );

  it(
    "un plat sain qui utilise deux fois la même sous-recette n'est PAS un cycle",
    () => {
      const sauce = ficheSousRecette({ nom: "Sauce", rendementQuantite: 1000, ingredients: INGREDIENTS_SAUCE });
      const plat = fiche([
        { nom: "Sauce (nappage)", quantite: 100, unite: "g", sousFicheId: sauce.id },
        { nom: "Sauce (garniture)", quantite: 100, unite: "g", sousFicheId: sauce.id },
      ]);
      const r = calculerCout(plat, mapAvec(sauce));
      expect(r.cycle).toBe(false);
      expect(r.incomplet).toBe(false);
      // 56,8237 / 1000 × 200 = 11,36474
      expect(r.coutTotal.toString()).toBe("11.36474");
    },
    2000,
  );
});

// ─── Robustesse ──────────────────────────────────────────────────────────────

describe("robustesse", () => {
  it("nombre de portions invalide : coût par portion non inventé, fiche annoncée incomplète", () => {
    const r = calculerCout(
      fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: 10, unite: "kg" } }], { nbPortions: 0 }),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.coutParPortion.toString()).toBe("10"); // 1 portion par défaut, incomplétude signalée
  });

  it("fiche sans ingrédient : coût INCONNU (jamais 0 « complet »), aucune marge", () => {
    const r = calculerCout(fiche([]), CTX_VIDE);
    expect(r.coutTotal.toNumber()).toBe(0);
    // Zéro ligne n'est pas un coût de zéro : la fiche est annoncée incomplète (aucun ingrédient
    // à nommer, donc `ingredientsSansPrix` reste vide — c'est le drapeau qui parle).
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual([]);
    expect(r.prixVenteHT).toBeNull();
  });

  it("fiche VIDE avec un prix de vente saisi : marge annoncée NON fiable, jamais 100 % en silence", () => {
    // Le geste naturel après « + Nouvelle fiche » : renseigner l'entête (prix TTC, coefficient)
    // AVANT de saisir les ingrédients. Sans le garde-fou, la fiche sortait « coût 0, marge
    // 20,24 $, taux de marque 100 % » sans la moindre mention — le plat le plus rentable de la
    // carte. Les chiffres restent calculés (l'écran doit pouvoir les montrer), mais `incomplet`
    // les qualifie, et c'est lui que lisent la liste, la fiche et l'export.
    const r = calculerCout(fiche([], { prixVenteTTC: 23.48, coefficientMargeCible: 8 }), CTX_VIDE);
    expect(r.incomplet).toBe(true);
    expect(r.lignes).toEqual([]);
    expect(r.prixVenteHT).toBe(20.24);
    expect(r.tauxMarque).toBe(1);
    // Aucun coût exploitable → pas de prix conseillé inventé depuis un coût de 0.
    expect(r.prixConseille).toBeNull();
  });

  it("fiche dont AUCUNE ligne n'est valorisée : incomplète, comme la fiche vide", () => {
    const r = calculerCout(
      fiche([{ nom: "Truffe", quantite: 0.01, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } }]),
      CTX_VIDE,
    );
    expect(r.incomplet).toBe(true);
    expect(r.ingredientsSansPrix).toEqual(["Truffe"]);
  });

  it("le contexte est facultatif (sous-fiches en ligne uniquement)", () => {
    const r = calculerCout(fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: 2, unite: "kg" } }]));
    expect(r.coutTotal.toString()).toBe("2");
  });

  it("détaille le coût ligne à ligne pour l'affichage", () => {
    const r = calculerCout(
      fiche([
        { nom: "Penne", quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 0.35, unite: "kg" } },
        { nom: "Truffe", quantite: 0.01, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } },
      ]),
      CTX_VIDE,
    );
    expect(r.lignes).toHaveLength(2);
    expect(r.lignes[0]!.cout!.toString()).toBe("0.07");
    expect(r.lignes[0]!.motif).toBeNull();
    expect(r.lignes[0]!.partiel).toBe(false);
    expect(r.lignes[1]!.cout).toBeNull();
    expect(r.lignes[1]!.motif).toBe("PRIX_ABSENT");
  });

  it("marque « partielle » la ligne d'une sous-recette elle-même incomplète", () => {
    const sauce = ficheSousRecette({
      nom: "Sauce",
      rendementQuantite: 1000,
      ingredients: [
        { nom: "Tomate", quantite: 1, unite: "kg", article: { prixUnitaireUSD: 2, unite: "kg" } },
        { nom: "Basilic", quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } },
      ],
    });
    const plat = fiche([{ nom: "Sauce", quantite: 500, unite: "g", sousFicheId: sauce.id }]);
    const r = calculerCout(plat, mapAvec(sauce));
    expect(r.lignes[0]!.cout!.toString()).toBe("1"); // minorant, pas un coût complet
    expect(r.lignes[0]!.partiel).toBe(true);
  });
});
