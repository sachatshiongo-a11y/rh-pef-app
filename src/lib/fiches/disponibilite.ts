import Decimal from "decimal.js";
import { facteur, poidsEmballage } from "@/lib/fiches/conversion";
import { uniteRendementIncoherente } from "@/lib/fiches/cout";

// Disponibilité des plats selon le stock : fonction PURE (ni Prisma, ni React), sœur du moteur de
// coût (`cout.ts`). Elle répond à « combien de portions puis-je sortir avec ce qui est en stock ? ».
//
// Trois doctrines, les mêmes que pour le coût :
//   1. Quantités EXACTES : chaque besoin est porté sous forme de fraction (numérateur/dénominateur)
//      et l'on ne divise qu'UNE fois, à la toute fin, avant l'unique arrondi à l'entier inférieur.
//      Sans cela, 200 g d'une sauce de 600 g donneraient 2,9999… fournées, donc 2 au lieu de 3.
//   2. Inconnu ANNONCÉ, jamais compté zéro : un ingrédient sans stock enregistré, d'unité non
//      convertible, pris dans une boucle ou dont la sous-recette n'a pas de rendement rend le plat
//      « À vérifier », avec la raison et le nom de l'ingrédient (décision Direction 2026-09-24).
//   3. Aucune valeur stockée : tout est recalculé à l'affichage.
//   4. Stock FIGÉ annoncé (décision Direction 2026-09-24) : un stock du dépôt sans mouvement depuis
//      plus de JOURS_MAX_SANS_MOUVEMENT jours (ou jamais mouvementé), ou un comptage du restaurant
//      aussi ancien, ne fait pas foi — le plat passe « À vérifier ». (Constat : aucune sortie
//      enregistrée au dépôt depuis juillet ; saumon fumé à 4,44 kg inchangé, « 111 portions ».)
//      La date de référence (`aujourdhui`) est un PARAMÈTRE : la fonction reste pure et testable.

/**
 * Au-delà de ce nombre de jours sans mouvement au dépôt (ou sans comptage au restaurant), le stock
 * ne fait plus foi. « Plus de 7 jours » : un stock mouvementé il y a exactement 7 jours compte encore.
 */
export const JOURS_MAX_SANS_MOUVEMENT = 7;

/** Decimal à haute précision : les produits de fractions ne doivent jamais être arrondis en route. */
const D = Decimal.clone({ precision: 60 });
type Dec = InstanceType<typeof D>;
const UN = new D(1);

// ─── Entrées (dénormalisées par l'appelant) ──────────────────────────────────

export type ArticleDispo = { id: string; designation: string; unite: string };

export type IngredientDispo = {
  /** Libellé affiché dans les raisons (« Crème fraîche »). */
  nom: string;
  /** Unité de consommation dans la recette (« g », « cl », « pièce »…). */
  unite: string;
  quantite: Decimal.Value;
  articleId: string | null;
  sousFicheId: string | null;
};

export type FicheDispo = {
  id: string;
  nom: string;
  nbPortions: number;
  estSousRecette: boolean;
  rendementQuantite: Decimal.Value | null;
  rendementUnite: string | null;
  ingredients: IngredientDispo[];
};

/** Stock du restaurant d'UN article du catalogue, déjà ramené à l'unité de l'article (texte). */
export type StockRestaurant =
  | { etat: "OK"; quantite: string; dateComptage: string }
  | { etat: "UNITE_NON_CONVERTIBLE"; articleResto: string };

/**
 * `depot` = `Stock.quantite` (null : aucune ligne `Stock`) ; `restaurant` = null : aucun comptage
 * rattaché ; `dernierMouvement` = date (AAAA-MM-JJ) du plus récent `MouvementStock` de l'article,
 * tous types, inventaire compris (null : jamais mouvementé).
 */
export type StockArticle = { depot: string | null; restaurant: StockRestaurant | null; dernierMouvement: string | null };

export type ContexteDispo = {
  fiches: Map<string, FicheDispo>;
  articles: Map<string, ArticleDispo>;
  stocks: Map<string, StockArticle>;
};

// ─── Sorties ─────────────────────────────────────────────────────────────────

export type EtatDispo = "DISPONIBLE" | "RUPTURE" | "A_VERIFIER";

export type MotifDispo =
  | "PAS_DE_STOCK"
  | "UNITE_NON_CONVERTIBLE"
  | "UNITE_NON_CONVERTIBLE_RESTAURANT"
  | "STOCK_NEGATIF"
  | "RENDEMENT_ABSENT"
  | "UNITE_RENDEMENT_INCOHERENTE"
  | "CYCLE"
  | "SOUS_FICHE_INTROUVABLE"
  | "SANS_SOURCE"
  | "QUANTITE_ILLISIBLE"
  | "QUANTITE_NON_RENSEIGNEE"
  | "STOCK_NON_MIS_A_JOUR"
  | "STOCK_JAMAIS_MIS_A_JOUR"
  | "COMPTAGE_RESTAURANT_ANCIEN"
  | "PORTIONS_INVALIDES"
  | "AUCUN_INGREDIENT";

/**
 * `ingredient` : chemin lisible (« Sauce › Crème »), ou null quand la raison porte sur la fiche.
 * `depuis` (AAAA-MM-JJ) : pour un stock figé, la date du dernier mouvement ou comptage.
 */
export type RaisonDispo = { motif: MotifDispo; ingredient: string | null; depuis?: string | null };

export type DetailArticleDispo = {
  articleId: string;
  designation: string;
  unite: string;
  /** Besoin pour UNE portion (plat) ou UN rendement (sous-recette), unité de l'article, texte. */
  besoinParPortion: string;
  depot: string | null;
  restaurant: string | null;
  dateComptage: string | null;
  /** Date (AAAA-MM-JJ) du dernier mouvement de stock au dépôt ; null : jamais mouvementé. */
  dernierMouvement: string | null;
  disponible: string | null;
  portions: number | null;
  motif: MotifDispo | null;
  /** Stock figé : date du dernier mouvement ou comptage qui fait la raison. */
  depuis: string | null;
};

export type DetailLigneDispo = {
  /** Articles de base atteints par la ligne (un seul pour un article, plusieurs pour une sous-recette). */
  articleIds: string[];
  raisons: RaisonDispo[];
  portions: number | null;
};

export type ResultatDisponibilite = {
  etat: EtatDispo;
  /** DISPONIBLE : > 0 ; RUPTURE : 0 ; A_VERIFIER : null (jamais un chiffre sur un inconnu). */
  portions: number | null;
  limitant: string | null;
  limitantId: string | null;
  enRupture: string[];
  raisons: RaisonDispo[];
  articles: DetailArticleDispo[];
  lignes: DetailLigneDispo[];
};

export const MOTIF_DISPO_LABEL: Record<MotifDispo, string> = {
  PAS_DE_STOCK: "pas de stock enregistré",
  UNITE_NON_CONVERTIBLE: "unité non convertible",
  UNITE_NON_CONVERTIBLE_RESTAURANT: "unité non convertible (restaurant)",
  STOCK_NEGATIF: "stock négatif",
  RENDEMENT_ABSENT: "sous-recette sans rendement renseigné",
  UNITE_RENDEMENT_INCOHERENTE: "rendement de la sous-recette dans une autre unité que la consommation",
  CYCLE: "boucle : la recette se contient elle-même",
  SOUS_FICHE_INTROUVABLE: "sous-recette introuvable",
  SANS_SOURCE: "ni article du stock ni sous-recette",
  QUANTITE_ILLISIBLE: "quantité illisible ou négative",
  QUANTITE_NON_RENSEIGNEE: "quantité non renseignée",
  STOCK_NON_MIS_A_JOUR: "stock non mis à jour",
  STOCK_JAMAIS_MIS_A_JOUR: "stock jamais mis à jour",
  COMPTAGE_RESTAURANT_ANCIEN: "comptage du restaurant non mis à jour",
  PORTIONS_INVALIDES: "nombre de portions inexploitable",
  AUCUN_INGREDIENT: "aucun ingrédient",
};

/** « Crème fraîche : pas de stock enregistré », ou « Aucun ingrédient » quand la raison porte sur la fiche. */
export function libelleRaison(r: RaisonDispo): string {
  // Stock figé : « stock non mis à jour depuis le 10/07 ».
  const texte = MOTIF_DISPO_LABEL[r.motif] + (r.depuis ? ` depuis le ${jjmm(r.depuis)}` : "");
  return r.ingredient ? `${r.ingredient} : ${texte}` : texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** « 2026-07-10 » → « 10/07 » (date PURE, aucune conversion de fuseau). */
const jjmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Jours civils entre deux dates PURES AAAA-MM-JJ (`jusquA` − `depuis`), calcul en UTC. */
export function joursEntre(depuis: string, jusquA: string): number {
  const t = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((t(jusquA) - t(depuis)) / 86_400_000);
}

/** Vrai si la date est plus ancienne que JOURS_MAX_SANS_MOUVEMENT jours à `aujourdhui`. */
const perimee = (date: string, aujourdhui: string) => joursEntre(date, aujourdhui) > JOURS_MAX_SANS_MOUVEMENT;

// ─── Fractions exactes ───────────────────────────────────────────────────────

type Fraction = { num: Dec; den: Dec };
const fr = (num: Dec, den: Dec = UN): Fraction => ({ num, den });
const fois = (a: Fraction, b: Fraction): Fraction => ({ num: a.num.times(b.num), den: a.den.times(b.den) });
const plus = (a: Fraction, b: Fraction): Fraction =>
  a.den.equals(b.den)
    ? { num: a.num.plus(b.num), den: a.den }
    : { num: a.num.times(b.den).plus(b.num.times(a.den)), den: a.den.times(b.den) };

function versD(valeur: Decimal.Value | null | undefined): Dec | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  try {
    const d = new D(valeur);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Convertit une quantité vers l'unité de l'article, par la MÊME règle que le coût : `facteur()`,
 * puis, pour une unité-emballage (« 500 GR »), le poids du paquet. `null` = conversion impossible —
 * jamais un facteur supposé.
 */
function versUniteArticle(q: Fraction, uniteSource: string, uniteArticle: string): Fraction | null {
  const f = facteur(uniteSource, uniteArticle);
  if (f !== null) return fois(q, fr(new D(f)));
  const poids = poidsEmballage(uniteArticle);
  if (poids !== null && poids.greaterThan(0)) {
    const versKg = facteur(uniteSource, "kg");
    if (versKg !== null) return fois(q, fr(new D(versKg), new D(poids)));
  }
  return null;
}

/** Quantité convertie vers l'unité d'un article, en texte pleine précision ; `null` si impossible. */
export function convertirVersUniteArticle(quantite: Decimal.Value, uniteSource: string, uniteArticle: string): string | null {
  const q = versD(quantite);
  if (q === null) return null;
  const r = versUniteArticle(fr(q), uniteSource, uniteArticle);
  return r === null ? null : r.num.div(r.den).toString();
}

// ─── Stock du restaurant rattaché au catalogue ───────────────────────────────

export type ComptageRattache = {
  articleStockId: string;
  designationResto: string;
  uniteResto: string | null;
  /** Date (AAAA-MM-JJ) du DERNIER comptage de cet article du restaurant. */
  date: string;
  quantite: Decimal.Value;
};

/**
 * Somme, par article du catalogue, du dernier comptage de chaque article du restaurant qui lui est
 * rattaché, convertie dans l'unité de l'article. Une conversion impossible rend l'article
 * « unité non convertible (restaurant) » : on n'additionne pas des bouteilles et des kilos.
 * Plusieurs articles du restaurant : la date retenue est la PLUS ANCIENNE des dernières dates —
 * c'est elle qui dit à quel point le chiffre peut être périmé.
 */
export function stockRestaurantParArticle(
  comptages: ComptageRattache[],
  unitesCatalogue: Map<string, string>,
): Map<string, StockRestaurant> {
  const res = new Map<string, StockRestaurant>();
  for (const c of comptages) {
    const deja = res.get(c.articleStockId);
    if (deja?.etat === "UNITE_NON_CONVERTIBLE") continue;
    const converti = convertirVersUniteArticle(c.quantite, c.uniteResto ?? "", unitesCatalogue.get(c.articleStockId) ?? "");
    if (converti === null) {
      res.set(c.articleStockId, { etat: "UNITE_NON_CONVERTIBLE", articleResto: c.designationResto });
      continue;
    }
    res.set(
      c.articleStockId,
      deja
        ? {
            etat: "OK",
            quantite: new D(deja.quantite).plus(converti).toString(),
            dateComptage: c.date < deja.dateComptage ? c.date : deja.dateComptage,
          }
        : { etat: "OK", quantite: converti, dateComptage: c.date },
    );
  }
  return res;
}

// ─── Décomposition ───────────────────────────────────────────────────────────

type Eclatement = { besoins: { articleId: string; besoin: Fraction }[]; raisons: RaisonDispo[] };

/**
 * Éclate une ligne jusqu'aux articles de base. `mult` est la part de la fiche parente consommée
 * (1 pour la fiche affichée ; quantité ÷ rendement pour une sous-recette), comme dans `calculerCout`.
 */
function eclater(ing: IngredientDispo, mult: Fraction, chemin: string, enCours: Set<string>, ctx: ContexteDispo): Eclatement {
  const label = chemin ? `${chemin} › ${ing.nom}` : ing.nom;
  const aVerifier = (motif: MotifDispo): Eclatement => ({ besoins: [], raisons: [{ motif, ingredient: label }] });

  // Même règle que le coût (`cout.ts`, QUANTITE_ABSENTE / QUANTITE_INVALIDE — spec A.1.4) : une
  // quantité à 0 n'est pas « n'en consomme pas », c'est une quantité NON RENSEIGNÉE. L'ignorer
  // donnerait un faux « Disponible » : un ingrédient de la recette ne serait jamais confronté au
  // stock. Une quantité négative est une saisie invalide.
  const q = versD(ing.quantite);
  if (q === null || q.isNegative()) return aVerifier("QUANTITE_ILLISIBLE");
  if (q.isZero()) return aVerifier("QUANTITE_NON_RENSEIGNEE");
  const quantite = fois(mult, fr(q));

  if (ing.articleId) {
    const article = ctx.articles.get(ing.articleId);
    if (!article) return aVerifier("SANS_SOURCE");
    const besoin = versUniteArticle(quantite, ing.unite, article.unite);
    if (besoin === null) return aVerifier("UNITE_NON_CONVERTIBLE");
    return { besoins: [{ articleId: article.id, besoin }], raisons: [] };
  }

  if (!ing.sousFicheId) return aVerifier("SANS_SOURCE");
  const sous = ctx.fiches.get(ing.sousFicheId);
  if (!sous) return aVerifier("SOUS_FICHE_INTROUVABLE");
  if (enCours.has(sous.id)) return aVerifier("CYCLE");
  const rendement = versD(sous.rendementQuantite);
  if (rendement === null || rendement.lessThanOrEqualTo(0)) return aVerifier("RENDEMENT_ABSENT");
  // Même garde que le coût : rendement et consommation dans la même unité de base, sans conversion.
  if (uniteRendementIncoherente(ing.unite, sous.rendementUnite)) return aVerifier("UNITE_RENDEMENT_INCOHERENTE");
  if (sous.ingredients.length === 0) return aVerifier("AUCUN_INGREDIENT");

  const part = fois(quantite, fr(UN, rendement));
  const suivant = new Set(enCours);
  suivant.add(sous.id);
  const out: Eclatement = { besoins: [], raisons: [] };
  for (const enfant of sous.ingredients) {
    const e = eclater(enfant, part, label, suivant, ctx);
    out.besoins.push(...e.besoins);
    out.raisons.push(...e.raisons);
  }
  return out;
}

type StockLu = {
  depot: Dec | null; restaurant: Dec | null; dateComptage: string | null; dernierMouvement: string | null;
  total: Dec | null; motif: MotifDispo | null; depuis: string | null;
};

function lireStock(articleId: string, ctx: ContexteDispo, aujourdhui: string): StockLu {
  const s = ctx.stocks.get(articleId);
  const depot = s ? versD(s.depot) : null;
  const dernierMouvement = s?.dernierMouvement ?? null;
  const r = s?.restaurant ?? null;
  const base = { depot, dernierMouvement, depuis: null };
  if (r !== null && r.etat === "UNITE_NON_CONVERTIBLE") {
    return { ...base, restaurant: null, dateComptage: null, total: null, motif: "UNITE_NON_CONVERTIBLE_RESTAURANT" };
  }
  const restaurant = r === null ? null : versD(r.quantite);
  const dateComptage = r === null ? null : r.dateComptage;
  const lu = { ...base, restaurant, dateComptage };
  if (depot === null && restaurant === null) return { ...lu, total: null, motif: "PAS_DE_STOCK" };
  const total = (depot ?? new D(0)).plus(restaurant ?? 0);
  if (total.isNegative()) return { ...lu, total, motif: "STOCK_NEGATIF" };
  // Stock figé : chaque part qui ENTRE dans le calcul doit être à jour. Le dépôt entre dans le
  // calcul dès qu'il a une ligne `Stock` ; le restaurant, dès qu'un comptage rattaché existe.
  if (depot !== null) {
    if (dernierMouvement === null) return { ...lu, total, motif: "STOCK_JAMAIS_MIS_A_JOUR" };
    if (perimee(dernierMouvement, aujourdhui)) return { ...lu, total, motif: "STOCK_NON_MIS_A_JOUR", depuis: dernierMouvement };
  }
  if (restaurant !== null && dateComptage !== null && perimee(dateComptage, aujourdhui)) {
    return { ...lu, total, motif: "COMPTAGE_RESTAURANT_ANCIEN", depuis: dateComptage };
  }
  return { ...lu, total, motif: null };
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Disponibilité d'une fiche. Un plat se compte en PORTIONS (quantités de la fiche ÷ nbPortions) ;
 * une sous-recette en RENDEMENTS (fournées entières). Fonction pure : aucune I/O, aucune exception.
 * `aujourdhui` (AAAA-MM-JJ, jour civil de Kinshasa) : référence de la règle du stock figé.
 */
export function calculerDisponibilite(fiche: FicheDispo, ctx: ContexteDispo, aujourdhui: string): ResultatDisponibilite {
  const raisons: RaisonDispo[] = [];
  const besoins = new Map<string, Fraction>(); // ordre d'insertion = ordre de la fiche
  const lignesBrutes: { articleIds: string[]; raisons: RaisonDispo[] }[] = [];
  const enCours = new Set([fiche.id]);

  for (const ing of fiche.ingredients) {
    const e = eclater(ing, fr(UN), "", enCours, ctx);
    const ids: string[] = [];
    for (const b of e.besoins) {
      const avant = besoins.get(b.articleId);
      besoins.set(b.articleId, avant ? plus(avant, b.besoin) : b.besoin);
      if (!ids.includes(b.articleId)) ids.push(b.articleId);
    }
    raisons.push(...e.raisons);
    lignesBrutes.push({ articleIds: ids, raisons: e.raisons });
  }

  let diviseur = UN;
  if (!fiche.estSousRecette) {
    if (!Number.isInteger(fiche.nbPortions) || fiche.nbPortions <= 0) raisons.push({ motif: "PORTIONS_INVALIDES", ingredient: null });
    else diviseur = new D(fiche.nbPortions);
  }

  const articles: DetailArticleDispo[] = [];
  for (const [articleId, besoin] of besoins) {
    const art = ctx.articles.get(articleId)!; // eclater ne produit que des articles connus
    const s = lireStock(articleId, ctx, aujourdhui);
    // ⌊ disponible ÷ (besoin ÷ diviseur) ⌋ = ⌊ disponible × diviseur × den ÷ num ⌋ : UNE division.
    const portions = s.motif === null && s.total !== null
      ? s.total.times(diviseur).times(besoin.den).div(besoin.num).floor().toNumber()
      : null;
    if (s.motif !== null) raisons.push({ motif: s.motif, ingredient: art.designation, ...(s.depuis ? { depuis: s.depuis } : {}) });
    articles.push({
      articleId,
      designation: art.designation,
      unite: art.unite,
      besoinParPortion: besoin.num.div(besoin.den).div(diviseur).toString(),
      depot: s.depot === null ? null : s.depot.toString(),
      restaurant: s.restaurant === null ? null : s.restaurant.toString(),
      dateComptage: s.dateComptage,
      dernierMouvement: s.dernierMouvement,
      disponible: s.total === null ? null : s.total.toString(),
      portions,
      motif: s.motif,
      depuis: s.depuis,
    });
  }

  if (besoins.size === 0 && raisons.length === 0) raisons.push({ motif: "AUCUN_INGREDIENT", ingredient: null });

  const parId = new Map(articles.map((a) => [a.articleId, a]));
  const lignes: DetailLigneDispo[] = lignesBrutes.map((l) => {
    const valeurs = l.articleIds.map((id) => parId.get(id)!.portions);
    const connues = l.raisons.length === 0 && valeurs.length > 0 && valeurs.every((v) => v !== null);
    return { ...l, portions: connues ? Math.min(...(valeurs as number[])) : null };
  });

  const base = { articles, lignes };
  if (raisons.length > 0) {
    return { etat: "A_VERIFIER", portions: null, limitant: null, limitantId: null, enRupture: [], raisons, ...base };
  }

  // Ingrédient limitant : le minimum ; en cas d'égalité, le PREMIER dans l'ordre de la fiche (`<` strict).
  let min = articles[0]!;
  for (const a of articles) if (a.portions! < min.portions!) min = a;

  if (min.portions === 0) {
    return {
      etat: "RUPTURE", portions: 0, limitant: min.designation, limitantId: min.articleId,
      enRupture: articles.filter((a) => a.portions === 0).map((a) => a.designation), raisons: [], ...base,
    };
  }
  return { etat: "DISPONIBLE", portions: min.portions, limitant: min.designation, limitantId: min.articleId, enRupture: [], raisons: [], ...base };
}

/** Décompte par état (tableau de bord de l'Exploitation). */
export function decompterEtats(resultats: Iterable<{ etat: EtatDispo }>): Record<EtatDispo, number> {
  const n: Record<EtatDispo, number> = { DISPONIBLE: 0, RUPTURE: 0, A_VERIFIER: 0 };
  for (const r of resultats) n[r.etat] += 1;
  return n;
}
