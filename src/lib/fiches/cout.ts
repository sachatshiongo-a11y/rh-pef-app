import Decimal from "decimal.js";
import { facteur, poidsEmballage } from "@/lib/fiches/conversion";

// Moteur de coût de revient des fiches techniques : PUR (aucun accès Prisma, aucune base,
// aucun React). Il consomme des données déjà dénormalisées et ne fait que du calcul.
//
// Deux doctrines le gouvernent :
//   1. Pleine précision Decimal du début à la fin, arrondi UNIQUE au centime en sortie.
//      Jamais de flottant, jamais d'arrondi intermédiaire (c'est ce qui fait 2,54 et pas 2,53).
//   2. Coût incomplet ANNONCÉ, jamais compté 0 : un ingrédient sans prix, d'unité inconvertible
//      ou pris dans un cycle n'est pas valorisé à zéro — il est listé et la fiche est marquée
//      `incomplet`. On ne devine jamais une valeur manquante.

// ─── Types d'entrée (dénormalisés par l'appelant) ────────────────────────────

/** Article du catalogue Stock, réduit à ce dont le calcul a besoin. */
export type ArticleCalc = {
  /** Prix d'achat HT à l'unité d'achat, en USD. `null` = pas de prix connu (jamais 0). */
  prixUnitaireUSD: Decimal.Value | null;
  /** Unité d'achat, TEXTE LIBRE saisi à la main (« kg », « L », « pièce », « 500 GR »…). */
  unite: string;
  /**
   * Nombre d'unités par carton. Volontairement INUTILISÉ ici : le prix de vérité est le prix
   * à l'unité (spec §12.5), on ne re-dérive jamais un prix depuis le carton. Le champ n'est
   * conservé que pour que l'appelant puisse passer sa ligne d'article telle quelle.
   */
  uniteParCarton?: number | null;
};

/** Ligne d'ingrédient : soit un article du Stock, soit une sous-recette. */
export type IngredientCalc = {
  id?: string;
  /** Libellé affiché dans `ingredientsSansPrix` / `lignes`. */
  nom?: string;
  /** Unité de consommation dans la recette (« g », « cl », « pièce »…). */
  unite: string;
  quantite: Decimal.Value;
  article?: ArticleCalc | null;
  /** Sous-recette fournie en ligne (prioritaire sur `sousFicheId`). */
  sousFiche?: FicheCalc | null;
  /** Sous-recette référencée par identifiant, résolue via `contexte.fiches`. */
  sousFicheId?: string | null;
};

export type FicheCalc = {
  id: string;
  nom?: string;
  nbPortions: number;
  tauxTVA: Decimal.Value;
  prixVenteTTC?: Decimal.Value | null;
  coefficientMargeCible?: Decimal.Value | null;
  estSousRecette: boolean;
  /** Rendement en unité de base (g pour une sauce) — indispensable pour servir de sous-recette. */
  rendementQuantite?: Decimal.Value | null;
  rendementUnite?: string | null;
  ingredients: IngredientCalc[];
};

export type ContexteCout = { fiches: Map<string, FicheCalc> };

// ─── Types de sortie ─────────────────────────────────────────────────────────

/** Pourquoi le coût d'une ligne est indéterminé (jamais « 0 »). */
export type MotifSansPrix =
  | "PRIX_ABSENT" // l'article n'a pas de prix unitaire
  | "UNITE_INCONVERTIBLE" // unité d'achat ↔ unité de consommation incompatibles ou inconnues
  | "QUANTITE_INVALIDE" // quantité absente, non numérique ou négative
  | "SANS_SOURCE" // ni article ni sous-fiche
  | "SOUS_FICHE_INTROUVABLE" // référence de sous-recette absente du contexte
  | "RENDEMENT_ABSENT" // sous-recette sans rendement exploitable
  | "CYCLE"; // la sous-recette se contient (directement ou non)

/** Détail d'une ligne, pour l'affichage (« Prix de revient HT » du classeur). */
export type LigneCout = {
  label: string;
  /** Coût HT en USD, pleine précision. `null` = indéterminé (jamais 0 par défaut). */
  cout: Decimal | null;
  motif: MotifSansPrix | null;
  /**
   * Vrai quand le coût existe mais provient d'une sous-recette elle-même incomplète : le
   * chiffre est un minorant, pas un coût complet. L'affichage doit le dire.
   */
  partiel: boolean;
};

export type ResultatCout = {
  /** Coût total HT, pleine précision (l'arrondi d'affichage reste à l'appelant). */
  coutTotal: Decimal;
  /** Coût HT par portion, pleine précision. */
  coutParPortion: Decimal;
  /** Vrai dès qu'une ligne est indéterminée, qu'un cycle existe ou que les portions sont invalides. */
  incomplet: boolean;
  /** Libellés des ingrédients dont le coût est indéterminé (préfixés du chemin de sous-recette). */
  ingredientsSansPrix: string[];
  lignes: LigneCout[];
  /** Ratios : pleine précision (ce ne sont pas des montants). */
  coefficient: number | null;
  tauxMarque: number | null;
  ratioMatiere: number | null;
  /** Montants : arrondis au centime. */
  prixVenteHT: number | null;
  prixVenteTTC: number | null;
  margeBrute: number | null;
  prixConseille: { ht: number; ttc: number } | null;
  cycle: boolean;
};

// ─── Utilitaires internes ────────────────────────────────────────────────────

const ZERO = new Decimal(0);

/** Conversion tolérante vers Decimal : `null` si la valeur est absente ou inexploitable. */
function versDecimal(valeur: Decimal.Value | null | undefined): Decimal | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  try {
    const d = new Decimal(valeur);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Arrondi au centime, en sortie uniquement. */
export function arrondirCentime(valeur: Decimal): number {
  return valeur.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function libelle(ingredient: IngredientCalc, index: number): string {
  return ingredient.nom ?? ingredient.sousFiche?.nom ?? ingredient.id ?? `Ingrédient n°${index + 1}`;
}

/**
 * Prix d'une unité de consommation pour un article donné.
 * Le prix est exprimé **par unité d'achat** : pour l'appliquer à une quantité exprimée en unité
 * de consommation, on convertit la quantité de consommation vers l'unité d'achat — d'où
 * `facteur(uniteConsommee → uniteAchat)`. (200 g d'un article à 2,99 $/kg = 200 × 0,00299.)
 */
function prixParUniteDeConsommation(
  article: ArticleCalc,
  uniteConsommee: string,
): { prix: Decimal } | { motif: MotifSansPrix } {
  const prixAchat = versDecimal(article.prixUnitaireUSD);
  if (prixAchat === null) return { motif: "PRIX_ABSENT" };

  const direct = facteur(uniteConsommee, article.unite);
  if (direct !== null) return { prix: prixAchat.times(direct) };

  // Unité-emballage (« 500 GR », « 1 KG ») : le prix est celui du paquet, l'unité en porte le
  // poids. On ramène au kilo, puis on convertit l'unité de consommation vers le kilo.
  const poids = poidsEmballage(article.unite);
  if (poids !== null && poids.greaterThan(0)) {
    const versKg = facteur(uniteConsommee, "kg");
    if (versKg !== null) return { prix: prixAchat.div(poids).times(versKg) };
  }

  // Unité inconnue ou incompatible : on ne suppose JAMAIS un facteur.
  return { motif: "UNITE_INCONVERTIBLE" };
}

type ResultatInterne = {
  coutTotal: Decimal;
  sansPrix: string[];
  lignes: LigneCout[];
  cycle: boolean;
};

function calculerInterne(
  fiche: FicheCalc,
  contexte: ContexteCout,
  enCours: Set<string>,
): ResultatInterne {
  const lignes: LigneCout[] = [];
  const sansPrix: string[] = [];
  let coutTotal = ZERO;
  let cycle = false;

  const suivant = new Set(enCours);
  suivant.add(fiche.id);

  fiche.ingredients.forEach((ingredient, index) => {
    const label = libelle(ingredient, index);

    // Une quantité absente ou aberrante ne doit pas se traduire par un coût de 0 « valide ».
    const quantite = versDecimal(ingredient.quantite);
    if (quantite === null || quantite.isNegative()) {
      lignes.push({ label, cout: null, motif: "QUANTITE_INVALIDE", partiel: false });
      sansPrix.push(label);
      return;
    }

    // ── Ingrédient article ──
    if (ingredient.article) {
      const prix = prixParUniteDeConsommation(ingredient.article, ingredient.unite);
      if ("motif" in prix) {
        lignes.push({ label, cout: null, motif: prix.motif, partiel: false });
        sansPrix.push(label);
        return;
      }
      const cout = quantite.times(prix.prix);
      lignes.push({ label, cout, motif: null, partiel: false });
      coutTotal = coutTotal.plus(cout);
      return;
    }

    // ── Ingrédient sous-recette ──
    const sousFiche =
      ingredient.sousFiche ??
      (ingredient.sousFicheId ? contexte.fiches.get(ingredient.sousFicheId) : undefined);

    if (!sousFiche) {
      const motif: MotifSansPrix = ingredient.sousFicheId ? "SOUS_FICHE_INTROUVABLE" : "SANS_SOURCE";
      lignes.push({ label, cout: null, motif, partiel: false });
      sansPrix.push(label);
      return;
    }

    // Garde-fou anti-cycle : rien ne l'interdit en base (A → B → A), il est porté ici.
    if (enCours.has(sousFiche.id) || sousFiche.id === fiche.id) {
      lignes.push({ label, cout: null, motif: "CYCLE", partiel: false });
      sansPrix.push(label);
      cycle = true;
      return;
    }

    const rendement = versDecimal(sousFiche.rendementQuantite);
    if (rendement === null || rendement.lessThanOrEqualTo(0)) {
      lignes.push({ label, cout: null, motif: "RENDEMENT_ABSENT", partiel: false });
      sansPrix.push(label);
      return;
    }

    const interne = calculerInterne(sousFiche, contexte, suivant);
    if (interne.cycle) cycle = true;
    for (const enfant of interne.sansPrix) sansPrix.push(`${label} › ${enfant}`);

    // AUCUNE conversion d'unité ici : rendement et consommation sont déjà dans la même unité
    // de base (le « cl » d'une sous-recette est un GRAMME, densité 1 — convertir multiplierait
    // le coût par 10).
    const cout = quantite.times(interne.coutTotal.div(rendement));
    lignes.push({ label, cout, motif: null, partiel: interne.sansPrix.length > 0 || interne.cycle });
    coutTotal = coutTotal.plus(cout);
  });

  return { coutTotal, sansPrix, lignes, cycle };
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Calcule le coût de revient HT d'une fiche technique, ses marges et son prix conseillé.
 * Fonction pure : aucune I/O, aucun effet de bord, aucune exception sur données incohérentes.
 */
export function calculerCout(
  fiche: FicheCalc,
  contexte: ContexteCout = { fiches: new Map() },
): ResultatCout {
  const { coutTotal, sansPrix, lignes, cycle } = calculerInterne(fiche, contexte, new Set());

  // Portions : une valeur invalide ne doit pas produire un coût/portion faussement précis —
  // on retombe sur 1 portion et on ANNONCE l'incomplétude.
  const portionsInvalides = !Number.isFinite(fiche.nbPortions) || fiche.nbPortions <= 0;
  const portions = portionsInvalides ? new Decimal(1) : new Decimal(fiche.nbPortions);
  const coutParPortion = coutTotal.div(portions);

  const tva = versDecimal(fiche.tauxTVA) ?? ZERO;
  const unPlusTva = tva.plus(1);
  const coefCible = versDecimal(fiche.coefficientMargeCible);
  const ttcSaisi = versDecimal(fiche.prixVenteTTC);
  const coutExploitable = coutParPortion.greaterThan(0);

  // Prix de vente : le prix réellement saisi prime ; à défaut, le mode par défaut est
  // COEFFICIENT-driven (PV HT = coût × coefficient), cf. spec §12.4.
  let htD: Decimal | null = null;
  let ttcD: Decimal | null = null;
  if (ttcSaisi !== null) {
    ttcD = ttcSaisi;
    htD = ttcSaisi.div(unPlusTva);
  } else if (coefCible !== null && coutExploitable) {
    htD = coutParPortion.times(coefCible);
    ttcD = htD.times(unPlusTva);
  }

  const margeD = htD === null ? null : htD.minus(coutParPortion);
  const htExploitable = htD !== null && htD.greaterThan(0);

  const prixConseille =
    coefCible !== null && coutExploitable
      ? (() => {
          const ht = coutParPortion.times(coefCible);
          return { ht: arrondirCentime(ht), ttc: arrondirCentime(ht.times(unPlusTva)) };
        })()
      : null;

  return {
    coutTotal,
    coutParPortion,
    incomplet: sansPrix.length > 0 || cycle || portionsInvalides,
    ingredientsSansPrix: sansPrix,
    lignes,
    coefficient: htD !== null && coutExploitable ? htD.div(coutParPortion).toNumber() : null,
    tauxMarque: htExploitable && margeD !== null ? margeD.div(htD!).toNumber() : null,
    ratioMatiere: htExploitable ? coutParPortion.div(htD!).toNumber() : null,
    prixVenteHT: htD === null ? null : arrondirCentime(htD),
    prixVenteTTC: ttcD === null ? null : arrondirCentime(ttcD),
    margeBrute: margeD === null ? null : arrondirCentime(margeD),
    prixConseille,
    cycle,
  };
}
