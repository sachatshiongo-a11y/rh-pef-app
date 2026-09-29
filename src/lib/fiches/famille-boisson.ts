import { normTexte } from "@/lib/texte";

// Rangement des fiches techniques sur l'écran Stock → Restaurant → Fiches techniques.
//
// DEUX règles, et une seule source pour chacune (tout écran qui range des fiches de la même façon
// importe ces fonctions au lieu de réécrire la condition) :
//
//   1. L'ONGLET vient du TYPE de la fiche. Une fiche BAR va dans « Boissons », une fiche PLAT dans
//      « Plats ». Les sous-recettes restent TOUJOURS dans « Plats », quel que soit leur type : ce
//      sont des composants de cuisine (sauces, bases…), pas des produits vendus au bar.
//
//   2. Dans « Boissons », la FAMILLE vient de la RUBRIQUE (`categorie`), JAMAIS du nom. Un
//      « Mojito » rangé en « Rhum » reste une boisson ; pour le déplacer, la Direction change sa
//      rubrique sur la fiche. Deviner à partir du nom (« contient “tail” », « contient “mojito” »)
//      rangerait mal en silence la première fiche au nom inattendu.

export type OngletFiches = "plats" | "boissons";
export type FamilleBoisson = "COCKTAIL" | "BOISSON";

/** Libellés affichés, dans l'ordre d'affichage. */
export const ONGLETS_FICHES: readonly { valeur: OngletFiches; libelle: string }[] = [
  { valeur: "plats", libelle: "Plats" },
  { valeur: "boissons", libelle: "Boissons" },
];
export const FAMILLES_BOISSON: readonly { valeur: FamilleBoisson; libelle: string }[] = [
  { valeur: "COCKTAIL", libelle: "Cocktails & mocktails" },
  { valeur: "BOISSON", libelle: "Boissons" },
];

/** Onglet lu dans l'URL (`?vue=`) : toute valeur inconnue ou absente retombe sur « plats ». */
export function lireOngletFiches(v: string | null | undefined): OngletFiches {
  return v === "boissons" ? "boissons" : "plats";
}

/** Onglet d'une fiche : BAR → Boissons, sauf les sous-recettes, qui restent avec les plats. */
export function ongletFiche(f: { type: string; estSousRecette: boolean }): OngletFiches {
  return f.type === "BAR" && !f.estSousRecette ? "boissons" : "plats";
}

/** Rubriques qui forment la famille « Cocktails & mocktails », sous leur forme normalisée. */
const RUBRIQUES_COCKTAIL = new Set(["cocktail", "mocktail"]);

/**
 * Forme comparable d'une rubrique : sans accents, sans casse, espaces resserrés, et le « s » du
 * pluriel retiré à la fin de chaque mot (« Cocktails » ≡ « cocktail »). Rien d'autre n'est
 * retiré : « Cocktail maison » n'est PAS « Cocktail » — une rubrique nouvelle se range dans
 * « Boissons » tant que la Direction ne l'a pas renommée.
 */
function rubriqueComparable(categorie: string | null | undefined): string {
  return normTexte(String(categorie ?? ""))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((mot) => (mot.length > 1 && mot.endsWith("s") ? mot.slice(0, -1) : mot))
    .join(" ");
}

/**
 * Famille d'une boisson d'après sa RUBRIQUE : « Cocktail » ou « Mocktail » (casse, accents et
 * pluriel ignorés) → Cocktails & mocktails ; toute autre rubrique, y compris vide → Boissons.
 */
export function familleBoisson(categorie: string | null | undefined): FamilleBoisson {
  return RUBRIQUES_COCKTAIL.has(rubriqueComparable(categorie)) ? "COCKTAIL" : "BOISSON";
}
