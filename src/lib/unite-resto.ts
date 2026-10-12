import Decimal from "decimal.js";
import { facteurVersArticle, normaliserUnite, uniteManquante } from "@/lib/fiches/conversion";
import { formaterNombre } from "@/lib/montant";
import type { ArticleCatalogueLie } from "@/lib/stock-restaurant";

// UNE SEULE UNITÉ PAR PRODUIT : celle de l'Inventaire (`ArticleStock.unite`) — règle de la Direction,
// 2026-10-12. Un article du restaurant rattaché a la même unité (normalisée) que ses articles du dépôt.
// Les articles qui ne l'ont pas (données d'avant la règle) sont LISTÉS, jamais convertis en silence :
// ce module PUR calcule, pour chacun, l'unité cible et le facteur EXACT (fraction) — ou dit pourquoi la
// conversion est impossible. L'écriture est dans `lib/validations-stock/unite-resto.ts`.

const D = Decimal.clone({ precision: 60 });

export type EcartUnite = {
  articleRestoId: string; designation: string; espace: "CUISINE" | "BAR";
  /** Unité du restaurant (null : aucune) et unité de l'Inventaire (la cible, telle qu'écrite au catalogue). */
  uniteResto: string | null; uniteInventaire: string | null;
} & (
  | { etat: "ALIGNABLE"; facteurNum: string; facteurDen: string }
  | { etat: "NON_CONVERTIBLE"; raison: string }
);

/**
 * Écart d'unité d'un article du restaurant avec ses articles rattachés ; `null` : rien à aligner (aucun
 * rattachement, ou même unité normalisée partout). `aDesComptages` : sans unité au restaurant, la poser
 * ne convertit rien tant qu'il n'y a pas de comptage (sinon on ne sait pas dans quelle unité ils sont).
 */
export function ecartUnite(
  resto: { id: string; designation: string; espace: "CUISINE" | "BAR"; unite: string | null },
  lies: readonly ArticleCatalogueLie[], aDesComptages: boolean,
): EcartUnite | null {
  if (lies.length === 0) return null;
  const base = { articleRestoId: resto.id, designation: resto.designation, espace: resto.espace, uniteResto: resto.unite };
  const nom = (l: ArticleCatalogueLie) => `« ${l.designation ?? l.id} »`;
  const sansUnite = lies.find((l) => uniteManquante(l.unite));
  if (sansUnite) return { ...base, uniteInventaire: null, etat: "NON_CONVERTIBLE", raison: `${nom(sansUnite)} n'a pas d'unité dans l'Inventaire : renseignez-la d'abord` };
  const unites = new Map(lies.map((l) => [normaliserUnite(l.unite!), l.unite!.trim()]));
  if (unites.size > 1) {
    return { ...base, uniteInventaire: null, etat: "NON_CONVERTIBLE", raison: `ses articles de l'Inventaire sont d'unités différentes (${[...unites.values()].join(", ")}) : alignez-les entre eux dans l'Inventaire d'abord` };
  }
  const cible = lies[0]!.unite!.trim();
  if (!uniteManquante(resto.unite) && normaliserUnite(resto.unite!) === normaliserUnite(cible)) return null;
  const inv = { ...base, uniteInventaire: cible };
  if (uniteManquante(resto.unite)) {
    return aDesComptages
      ? { ...inv, etat: "NON_CONVERTIBLE", raison: "l'article du restaurant n'a pas d'unité mais des comptages : leur unité est inconnue, rien à convertir sans la deviner" }
      : { ...inv, etat: "ALIGNABLE", facteurNum: "1", facteurDen: "1" };
  }
  // Facteur de CHAQUE article rattaché (contenance comprise) : ils doivent s'accorder, sinon le choix serait arbitraire.
  const facteurs = lies.map((l) => ({ l, f: facteurVersArticle(resto.unite!, { unite: l.unite, contenance: l.contenance ?? null, contenanceUnite: l.contenanceUnite ?? null }) }));
  const sans = facteurs.find((x) => x.f === null);
  if (sans) return { ...inv, etat: "NON_CONVERTIBLE", raison: `aucun facteur entre ${resto.unite!.trim()} et ${cible} pour ${nom(sans.l)} (contenance absente ou grandeurs différentes)` };
  const premier = facteurs[0]!.f!;
  const valeur = (f: { num: Decimal; den: Decimal }) => new D(f.num).div(f.den);
  if (facteurs.some((x) => !valeur(x.f!).equals(valeur(premier)))) {
    return { ...inv, etat: "NON_CONVERTIBLE", raison: "ses articles de l'Inventaire donnent des facteurs différents (contenances différentes) : le choix serait arbitraire" };
  }
  return { ...inv, etat: "ALIGNABLE", facteurNum: new D(premier.num).toString(), facteurDen: new D(premier.den).toString() };
}

/** Convertit une quantité par le facteur EXACT (quantité × num ÷ den). `exact` : tient dans la précision de la base (3 décimales). */
export function convertirQuantite(quantite: Decimal.Value, facteurNum: string, facteurDen: string): { valeur: string; exact: boolean } {
  const v = new D(quantite).times(facteurNum).div(facteurDen);
  return { valeur: v.toString(), exact: v.toDecimalPlaces(3).equals(v) };
}

/** « ×1 000 », « ÷4 », « ×0,5 » : le facteur lisible d'une conversion. */
export function libelleFacteur(facteurNum: string, facteurDen: string): string {
  const f = new D(facteurNum).div(facteurDen);
  const nb = (d: Decimal) => formaterNombre(d.toNumber(), { maximumFractionDigits: 6 });
  const inverse = new D(1).div(f);
  return !f.isInteger() && inverse.isInteger() ? `÷${nb(inverse)}` : `×${nb(f)}`;
}
