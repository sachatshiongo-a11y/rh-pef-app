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

/**
 * Facteur multiplicatif pour convertir une quantité exprimée en `uniteSource` vers `uniteCible`.
 * Renvoie `null` si la conversion est impossible (grandeurs différentes, unité inconnue,
 * ou unités de comptage distinctes) — ce `null` doit être propagé tel quel par l'appelant.
 */
export function facteur(uniteSource: string, uniteCible: string): Decimal | null {
  const source = normaliserUnite(uniteSource);
  const cible = normaliserUnite(uniteCible);

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
