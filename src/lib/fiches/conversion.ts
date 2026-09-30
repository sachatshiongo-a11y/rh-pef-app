import Decimal from "decimal.js";

// Utilitaire pur de conversion d'unités pour les fiches techniques : aucune dépendance
// Prisma/base, uniquement des Decimal en pleine précision (jamais de flottant).

// Variantes d'écriture courantes ramenées à l'unité canonique déjà connue du système.
// Attention : ceci n'est QUE de l'orthographe — chaque entrée désigne exactement la même
// unité physique que sa cible (« litre » = « l »), jamais une unité différente. N'ajouter
// ici aucune équivalence entre grandeurs distinctes (ex. un poids d'emballage n'est pas un
// alias d'unité de comptage : cela relève de poidsEmballage, pas de cette table).
const ALIAS_UNITE: Record<string, string> = {
  // Masse
  gramme: "g",
  grammes: "g",
  gr: "g",
  kilo: "kg",
  kilos: "kg",
  kilogramme: "kg",
  kilogrammes: "kg",
  // Volume
  litre: "l",
  litres: "l",
  millilitre: "ml",
  millilitres: "ml",
  centilitre: "cl",
  centilitres: "cl",
  // Comptage : pluriels vers le singulier déjà reconnu
  pièces: "pièce",
  unités: "unité",
  bouteilles: "bouteille",
  boîtes: "boîte",
  paquets: "paquet",
};

/** Normalise une unité pour comparaison : minuscules, espaces superflus retirés, variantes
 * d'écriture courantes ramenées à l'unité canonique (ex. « Litres » → « l »). */
export function normaliserUnite(unite: string): string {
  const brut = unite.trim().toLowerCase();
  return ALIAS_UNITE[brut] ?? brut;
}

// Facteurs vers l'unité de référence de chaque grandeur (base = gramme pour la masse,
// millilitre pour le volume). Le facteur source→cible se déduit par division des deux.
const MASSE_VERS_G: Record<string, Decimal> = {
  g: new Decimal(1),
  kg: new Decimal(1000),
};

const VOLUME_VERS_ML: Record<string, Decimal> = {
  ml: new Decimal(1),
  cl: new Decimal(10),
  l: new Decimal(1000),
};

// Unités de comptage : ne se convertissent jamais vers une masse ou un volume, ni entre
// elles — seulement vers elles-mêmes (facteur 1).
const UNITES_COMPTAGE = new Set(["pièce", "unité", "bouteille", "boîte", "paquet"]);

/** Vrai si l'unité est absente (vide ou blanche) : « unité manquante ». */
export function uniteManquante(unite: string | null | undefined): boolean {
  return normaliserUnite(unite ?? "") === "";
}

/**
 * Facteur multiplicatif pour convertir une quantité exprimée en `uniteSource` vers `uniteCible`.
 * Renvoie `null` si la conversion est impossible (grandeurs différentes, unité inconnue,
 * ou unités de comptage distinctes) — ce `null` doit être propagé tel quel par l'appelant.
 */
export function facteur(uniteSource: string, uniteCible: string): Decimal | null {
  const source = normaliserUnite(uniteSource);
  const cible = normaliserUnite(uniteCible);

  // Une unité VIDE n'est pas une unité : c'est « unité manquante ». Deux unités vides ne sont
  // donc pas « identiques » (facteur 1) — ce serait supposer que deux inconnues se valent.
  // Placé AVANT l'identité ci-dessous. (Vérifié sur le classeur réel des fiches, 2026-09-24 :
  // aucune ligne d'ingrédient n'a d'unité de consommation vide — la saisie l'exige — donc aucun
  // coût de fiche ne change.)
  if (source === "" || cible === "") return null;

  // Une unité rapportée à elle-même vaut toujours 1 — vrai par construction, que l'unité soit
  // connue du système ou non (ex. « 500 GR » consommé en « 500 GR » : un conditionnement acheté
  // et consommé à l'unité). Ce contrôle est volontairement placé AVANT les tables de grandeurs
  // pour ne jamais pouvoir être court-circuité par elles. Il ne concerne QUE l'identité stricte :
  // deux unités différentes, même inconnues toutes les deux, continuent de renvoyer null plus bas.
  if (source === cible) {
    return new Decimal(1);
  }

  if (UNITES_COMPTAGE.has(source) || UNITES_COMPTAGE.has(cible)) {
    return source === cible ? new Decimal(1) : null;
  }

  if (source in MASSE_VERS_G && cible in MASSE_VERS_G) {
    return MASSE_VERS_G[source]!.div(MASSE_VERS_G[cible]!);
  }

  if (source in VOLUME_VERS_ML && cible in VOLUME_VERS_ML) {
    return VOLUME_VERS_ML[source]!.div(VOLUME_VERS_ML[cible]!);
  }

  return null;
}

// Parse une unité d'emballage du type « 500 GR » ou « 1 KG » (espace optionnel entre le
// nombre et l'unité de masse) et renvoie son poids en kilogrammes.
const EMBALLAGE_REGEX = /^(\d+(?:[.,]\d+)?)\s*(gr|g|kg)$/i;

/** Poids en kg d'une unité d'emballage saisie en toutes lettres (« 500 GR », « 1 KG »). */
export function poidsEmballage(unite: string): Decimal | null {
  const match = normaliserUnite(unite).match(EMBALLAGE_REGEX);
  if (!match) return null;

  const quantite = new Decimal(match[1]!.replace(",", "."));
  const uniteMasse = match[2] === "kg" ? "kg" : "g";
  return quantite.times(facteur(uniteMasse, "kg")!);
}

// ─── Unité de STOCK d'un article (contenance comprise) ───────────────────────
//
// SEULE porte d'entrée pour ramener une quantité (consommée par une fiche, comptée au restaurant)
// à l'unité de stock d'un ARTICLE du catalogue : coût (cout.ts), disponibilité et stock du
// restaurant (disponibilite.ts), contrôle de l'import des fiches du bar (classeur-bar.ts). Un
// garde-fou de source (conversion-porte-unique.test.ts) interdit d'appeler `facteur()` ou
// `poidsEmballage()` sur l'unité d'un article ailleurs qu'ici.

/**
 * Unités de COMPTAGE d'un article (on stocke des bouteilles, des pièces…), pluriels et « (s) »
 * compris. « Carton » n'en est volontairement PAS : un carton contient des bouteilles, pas un
 * volume — sa contenance serait ambiguë.
 */
const COMPTAGE_STOCK = new Set(["bouteille", "piece", "unite", "boite", "paquet", "sachet", "canette", "brique", "flacon", "pot"]);

/** Vrai si l'article se compte à l'unité (« Bouteille », « Bouteille(s) », « Pièces »…). */
export function estUniteComptage(unite: string | null | undefined): boolean {
  const u = normaliserUnite(unite ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\(s\)$/, "").replace(/s$/, "");
  return COMPTAGE_STOCK.has(u);
}

/** Unités admises pour une contenance : une grandeur convertible (volume ou masse). */
export const UNITES_CONTENANCE = ["ml", "cl", "l", "g", "kg"] as const;
export type UniteContenance = (typeof UNITES_CONTENANCE)[number];

/** Article réduit à ce qui décide d'une conversion vers son unité de stock. */
export type UniteArticle = {
  unite: string | null;
  /** Contenance d'UNE unité de stock (75 pour « 75 cl ») ; null/absente = inconnue. */
  contenance?: Decimal.Value | null;
  contenanceUnite?: string | null;
};

/** Facteur exact en fraction : quantité × num ÷ den = quantité dans l'unité de stock. */
export type FacteurArticle = { num: Decimal; den: Decimal };

function contenanceValide(a: UniteArticle): { q: Decimal; unite: string } | null {
  if (a.contenance === null || a.contenance === undefined || a.contenance === "" || !a.contenanceUnite) return null;
  try {
    const q = new Decimal(a.contenance);
    return q.isFinite() && q.greaterThan(0) ? { q, unite: a.contenanceUnite } : null;
  } catch {
    return null;
  }
}

/**
 * Facteur pour ramener une quantité exprimée en `uniteConso` à l'unité de STOCK de l'article, dans
 * cet ordre :
 *  1. conversion directe (`facteur`) — « g » vers « kg », « Bouteille » vers « Bouteille » ;
 *  2. article compté à l'unité (Bouteille, Pièce…) dont la CONTENANCE est de la même grandeur que
 *     la consommation : facteur(uniteConso → contenanceUnite) ÷ contenance. 5 cl d'une bouteille
 *     de 1 L = 5 × (1/100) ÷ 1 = 0,05 bouteille ;
 *  3. unité-emballage (« 500 GR ») : poids du paquet, ramené au kilo (comportement historique).
 * `null` = conversion impossible, jamais un facteur supposé : une contenance inconnue n'est pas 1.
 * Résultat en fraction (num ÷ den) pour que coût et disponibilité restent exacts.
 */
export function facteurVersArticle(uniteConso: string, article: UniteArticle): FacteurArticle | null {
  const unite = article.unite ?? "";
  const direct = facteur(uniteConso, unite);
  if (direct !== null) return { num: direct, den: new Decimal(1) };

  const contenance = contenanceValide(article);
  if (contenance && estUniteComptage(unite)) {
    const f = facteur(uniteConso, contenance.unite);
    if (f !== null) return { num: f, den: contenance.q };
  }

  const poids = poidsEmballage(unite);
  if (poids !== null && poids.greaterThan(0)) {
    const versKg = facteur(uniteConso, "kg");
    if (versKg !== null) return { num: versKg, den: poids };
  }
  return null;
}

// ─── Contenance lue dans une désignation ─────────────────────────────────────

const CONTENANCE_REGEX = /(\d+(?:[.,]\d+)?)\s*(ml|cl|ltr|lt|litres?|l|kg|gr|g)(?![a-z])/gi;
const UNITE_LUE: Record<string, UniteContenance> = { ml: "ml", cl: "cl", l: "l", lt: "l", ltr: "l", litre: "l", litres: "l", kg: "kg", g: "g", gr: "g" };

/**
 * Contenance écrite dans un nom d'article : « Absolut Vodka-75cl » → 75 cl, « Campari-1L » → 1 l,
 * « MONIN COCONUT FRUIT 1LTR » → 1 l, « Hendrick S-700ml » → 700 ml, « Monin … Powder 2KG » →
 * 2 kg. La DERNIÈRE mention l'emporte (« 12 X 1KG » → 1 kg, le contenu d'une unité). Un nombre sans
 * unité (« Jus d'Ananas-100 », « Sirop …-70 ») ne se lit pas : null, jamais une unité supposée.
 */
export function contenanceDansNom(nom: string): { quantite: Decimal; unite: UniteContenance } | null {
  const texte = nom.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let derniere: RegExpExecArray | null = null;
  for (const m of texte.matchAll(CONTENANCE_REGEX)) {
    // Le nombre ne doit pas être collé à ce qui le précède : une lettre (« V8 », « B52cl »), un
    // chiffre, ou un séparateur de nombre (« .7L » n'est pas 7 l, « 1/2 L » n'est pas 2 l).
    const avant = texte[(m.index ?? 0) - 1];
    if (avant && /[a-z0-9./,]/i.test(avant)) continue;
    derniere = m as RegExpExecArray;
  }
  if (!derniere) return null;
  const quantite = new Decimal(derniere[1]!.replace(",", "."));
  if (!quantite.greaterThan(0)) return null;
  return { quantite, unite: UNITE_LUE[derniere[2]!.toLowerCase()]! };
}

/**
 * Contenance ramenée à l'unité de base de sa grandeur (« v:700 » pour 70 cl, « m:2000 » pour
 * 2 kg), pour comparer deux écritures : 1L = 1LTR = 100cl = 1000ML ; 70CL = 700ML.
 */
export function contenanceCanonique(c: { quantite: Decimal.Value; unite: string } | null): string | null {
  if (!c) return null;
  const q = new Decimal(c.quantite);
  const ml = facteur(c.unite, "ml");
  if (ml !== null) return `v:${q.times(ml).toString()}`;
  const g = facteur(c.unite, "g");
  return g !== null ? `m:${q.times(g).toString()}` : null;
}

/**
 * Contenance saisie au catalogue (formulaire d'article) : les deux champs vides = pas de
 * contenance ; sinon un nombre > 0 (virgule admise, 3 décimales au plus — Decimal(12,3)) ET une
 * unité de contenance. Lève un message lisible, jamais une valeur supposée.
 */
export function lireContenanceSaisie(quantiteBrute: unknown, uniteBrute: unknown): { contenance: string | null; contenanceUnite: UniteContenance | null } {
  const q = String(quantiteBrute ?? "").trim().replace(",", ".");
  const u = String(uniteBrute ?? "").trim();
  if (!q && !u) return { contenance: null, contenanceUnite: null };
  const unite = UNITES_CONTENANCE.find((x) => x === u);
  if (!q || !unite) throw new Error("Contenance : saisissez un nombre ET une unité (ml, cl, l, g, kg), ou videz les deux.");
  // Chiffres décimaux seulement : ni « 1e5 », ni « 0x10 », ni « Infinity » (que Decimal accepterait).
  if (!/^\d+(\.\d+)?$/.test(q)) throw new Error("Contenance : nombre illisible.");
  const d = new Decimal(q);
  if (!d.isFinite() || !d.greaterThan(0) || d.greaterThan(100000)) throw new Error("Contenance : un nombre supérieur à 0 est attendu.");
  if (!d.toDecimalPlaces(3).equals(d)) throw new Error("Contenance : 3 décimales au plus.");
  return { contenance: d.toString(), contenanceUnite: unite };
}
