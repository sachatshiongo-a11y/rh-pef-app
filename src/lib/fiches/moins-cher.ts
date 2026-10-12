import Decimal from "decimal.js";
import { marquesDifferentes, memeDesignation } from "@/lib/achats-doublons";
import { prixParUniteDeConsommation } from "@/lib/fiches/cout";
import { contenanceCanonique, estUniteComptage, normaliserUnite } from "@/lib/fiches/conversion";

// SIGNAL « une autre marque revient moins cher » (Direction, 2026-10-14). Pur : aucun accès base.
// Une fiche technique pointe UN article (donc UNE marque) : son coût est celui du prix de cette
// marque, rien d'autre. Ce module ne CHANGE JAMAIS la ligne : il compare, il signale, la personne
// décide (l'outil signale, la Direction tranche).
//
// Comparable seulement si : même désignation normalisée (casse, accents, écriture de la contenance),
// marque différente et renseignée, article actif au prix connu et > 0, et prix ramené à l'unité de
// l'INGRÉDIENT par la porte unique du moteur de coût (`prixParUniteDeConsommation`) — jamais une
// conversion supposée. Ingrédient compté à la pièce / bouteille : la contenance des deux articles
// doit être la même (une bouteille de 70 cl ne se compare pas à une de 1 L « par bouteille »).

export type ArticlePrix = {
  id: string;
  designation: string;
  marque?: string | null;
  unite: string;
  prixUnitaireUSD: string | null;
  prixApprox?: boolean;
  actif: boolean;
  contenance?: string | null;
  contenanceUnite?: string | null;
};

export type AlternativeMoinsChere = {
  articleId: string;
  marque: string;
  /** Prix de l'alternative et prix actuel, dans la MÊME unité d'affichage (`unite`), en dollars, texte pleine précision. */
  prix: string;
  prixActuel: string;
  /** « kg », « L », ou l'unité de l'ingrédient (« pièce »). */
  unite: string;
  /** Un des deux prix vient d'un article en francs converti au taux du jour. */
  approx: boolean;
};

/** Unité d'affichage lisible : le prix d'un gramme se lit au kilo. */
function affichage(uniteLigne: string): { facteur: Decimal; unite: string } {
  switch (normaliserUnite(uniteLigne)) {
    case "g": return { facteur: new Decimal(1000), unite: "kg" };
    case "ml": return { facteur: new Decimal(1000), unite: "L" };
    case "cl": return { facteur: new Decimal(100), unite: "L" };
    case "kg": return { facteur: new Decimal(1), unite: "kg" };
    case "l": return { facteur: new Decimal(1), unite: "L" };
    default: return { facteur: new Decimal(1), unite: uniteLigne.trim() };
  }
}

const calc = (a: ArticlePrix) => ({ prixUnitaireUSD: a.prixUnitaireUSD, unite: a.unite, contenance: a.contenance ?? null, contenanceUnite: a.contenanceUnite ?? null });

/**
 * La marque la MOINS CHÈRE parmi les autres articles de même désignation, si elle l'est strictement
 * pour cet ingrédient (`uniteLigne`) ; null sinon (aucune alternative, prix inconnu, non comparable).
 */
export function alternativeMoinsChere(article: ArticlePrix, uniteLigne: string, catalogue: readonly ArticlePrix[]): AlternativeMoinsChere | null {
  if (!uniteLigne.trim()) return null;
  const actuel = prixParUniteDeConsommation(calc(article), uniteLigne);
  if ("motif" in actuel) return null;
  const aLaPiece = estUniteComptage(uniteLigne);
  const contActuelle = contenanceCanonique(article.contenance && article.contenanceUnite ? { quantite: article.contenance, unite: article.contenanceUnite } : null);
  let meilleur: { a: ArticlePrix; prix: Decimal } | null = null;
  for (const a of catalogue) {
    if (a.id === article.id || !a.actif) continue;
    const marque = (a.marque ?? "").trim();
    if (!marque) continue; // une alternative est une AUTRE marque, nommée
    if ((article.marque ?? "").trim() && !marquesDifferentes(marque, article.marque)) continue; // la même marque
    if (!memeDesignation(article.designation, a.designation)) continue;
    if (aLaPiece) {
      const cont = contenanceCanonique(a.contenance && a.contenanceUnite ? { quantite: a.contenance, unite: a.contenanceUnite } : null);
      if (cont !== contActuelle) continue;
    }
    const p = prixParUniteDeConsommation(calc(a), uniteLigne);
    if ("motif" in p) continue;
    if (p.prix.lessThan(actuel.prix) && (!meilleur || p.prix.lessThan(meilleur.prix))) meilleur = { a, prix: p.prix };
  }
  if (!meilleur) return null;
  const { facteur: f, unite } = affichage(uniteLigne);
  return {
    articleId: meilleur.a.id,
    marque: (meilleur.a.marque ?? "").trim(),
    prix: meilleur.prix.times(f).toString(),
    prixActuel: actuel.prix.times(f).toString(),
    unite,
    approx: article.prixApprox === true || meilleur.a.prixApprox === true,
  };
}
