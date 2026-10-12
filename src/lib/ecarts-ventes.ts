import Decimal from "decimal.js";
import { convertirVersUniteArticle } from "@/lib/fiches/disponibilite";
import { articleCatalogueLie, ecartVentesConsommation, type EcartPeriode, type EntreesStockResto } from "@/lib/stock-restaurant";

// CONTRÔLE « Écarts ventes / consommation » (décision Direction, 2026-10-12) : pour une période, par
// article du restaurant, la consommation RÉELLE (comptages + livraisons) face à la consommation THÉORIQUE
// (ventes saisies × fiches techniques), l'écart en quantité et en valeur. SIGNAL SEULEMENT : aucune
// écriture, aucun stock corrigé. Bar et Cuisine séparés. Fonction PURE.
//
// Valeur : le prix de l'article du catalogue rattaché, DANS SA DEVISE DE SAISIE (jamais converti pour
// l'affichage) ; plusieurs marques rattachées au prix différent → la première en prix connu, la valeur est
// marquée « ≈ ». Les totaux se font PAR DEVISE (jamais des dollars et des francs additionnés).

const D = Decimal.clone({ precision: 60 });

export type PrixCatalogue = { devise: "USD" | "CDF"; montant: string };
export type ValeurEcart = { devise: "USD" | "CDF"; montant: string; approx: boolean };

export type LigneEcart = {
  articleRestoId: string; designation: string; espace: "CUISINE" | "BAR"; unite: string | null;
  periode: EcartPeriode;
  /** Valeur SIGNÉE de l'écart (positif = consommé en plus). null : pas de prix connu / unité inconvertible, ou écart inconnu. */
  valeur: ValeurEcart | null;
};

export type EcartsVentes = {
  CUISINE: LigneEcart[]; BAR: LigneEcart[];
  /** Total NET de l'écart des lignes connues, par espace et par devise (texte pleine précision). */
  totaux: Record<"CUISINE" | "BAR", Partial<Record<"USD" | "CDF", string>>>;
};

/** Valeur de l'écart (unité du restaurant) au prix du catalogue ; null si aucun rattaché n'a de prix convertible. */
export function valeurDeLEcart(
  e: EntreesStockResto, articleRestoId: string, ecart: string, prix: ReadonlyMap<string, PrixCatalogue>,
): ValeurEcart | null {
  const a = e.articles.find((x) => x.id === articleRestoId);
  if (!a) return null;
  const valeurs: { devise: "USD" | "CDF"; montant: InstanceType<typeof D> }[] = [];
  for (const lie of a.rattaches) {
    const p = prix.get(lie.id);
    if (!p) continue;
    const q = convertirVersUniteArticle(ecart, a.unite ?? "", articleCatalogueLie(lie));
    if (q === null) continue;
    valeurs.push({ devise: p.devise, montant: new D(q).times(p.montant) });
  }
  if (valeurs.length === 0) return null;
  const premiere = valeurs[0]!;
  const approx = valeurs.some((v) => v.devise !== premiere.devise || !v.montant.minus(premiere.montant).abs().lessThanOrEqualTo(premiere.montant.abs().times("0.0001")));
  return { devise: premiere.devise, montant: premiere.montant.toString(), approx };
}

/**
 * Lignes triées par écart le plus fort (valeur absolue ; en dollars équivalents au taux du jour pour
 * comparer des devises différentes — le taux ne sert QU'AU TRI, jamais à l'affichage), puis les lignes
 * sans valeur par quantité, puis les écarts inconnus.
 */
export function ecartsVentesConsommation(
  e: EntreesStockResto, debut: string, fin: string, prix: ReadonlyMap<string, PrixCatalogue>,
  { espace, tauxCDFParUSD = null }: { espace?: "CUISINE" | "BAR"; tauxCDFParUSD?: number | null } = {},
): EcartsVentes {
  const lignes: LigneEcart[] = e.articles
    .filter((a) => a.rattaches.length > 0 && (!espace || a.espace === espace))
    .map((a) => {
      const periode = ecartVentesConsommation(e, a.id, debut, fin);
      return {
        articleRestoId: a.id, designation: a.inactif ? `${a.designation} (désactivé)` : a.designation, espace: a.espace, unite: a.unite, periode,
        valeur: periode.etat === "CONNUE" ? valeurDeLEcart(e, a.id, periode.ecart, prix) : null,
      };
    });
  const cleTri = (l: LigneEcart): [number, number] => {
    if (l.periode.etat !== "CONNUE") return [3, 0];
    if (l.valeur) {
      const m = new D(l.valeur.montant).abs().toNumber();
      const usd = l.valeur.devise === "USD" ? m : tauxCDFParUSD ? m / tauxCDFParUSD : m;
      return [l.valeur.devise === "CDF" && !tauxCDFParUSD ? 1 : 0, -usd];
    }
    return [2, -new D(l.periode.ecart).abs().toNumber()];
  };
  const trier = (x: LigneEcart[]) => [...x].sort((p, q) => { const a = cleTri(p), b = cleTri(q); return a[0] - b[0] || a[1] - b[1] || p.designation.localeCompare(q.designation, "fr"); });
  const res: EcartsVentes = { CUISINE: trier(lignes.filter((l) => l.espace === "CUISINE")), BAR: trier(lignes.filter((l) => l.espace === "BAR")), totaux: { CUISINE: {}, BAR: {} } };
  for (const esp of ["CUISINE", "BAR"] as const) {
    for (const l of res[esp]) {
      if (!l.valeur) continue;
      res.totaux[esp][l.valeur.devise] = new D(res.totaux[esp][l.valeur.devise] ?? 0).plus(l.valeur.montant).toString();
    }
  }
  return res;
}
