import Decimal from "decimal.js";
import { besoinsParPortion, libelleRaison, type ArticleDispo, type FicheDispo } from "@/lib/fiches/disponibilite";

// CONSOMMATION THÉORIQUE DES VENTES (décision Direction, 2026-10-12) : ce que les plats et boissons VENDUS
// (`VenteJournaliere`) ont dû consommer, d'après leurs FICHES TECHNIQUES. Fonction PURE (ni Prisma ni
// React). Elle alimente le stock théorique du restaurant (dernier comptage + livraisons − ventes) et le
// contrôle « Écarts ventes / consommation ».
//
// Doctrine : l'inconnu est ANNONCÉ, jamais compté zéro. Une vente sur une fiche incomplète (quantité non
// renseignée, unité non convertible, sous-recette sans rendement, aucun ingrédient, portions
// inexploitables) ne produit PAS de consommation pour ses lignes inexploitables : elle est rendue dans
// `aVerifier`, avec les articles concernés, et le stock théorique de ces articles devient « À vérifier ».

const D = Decimal.clone({ precision: 60 });

/** Une vente saisie : `quantite` = nombre de portions / verres vendus ce jour-là (0 = rien vendu, ignoré). */
export type VenteSR = { date: string; ficheId: string; quantite: number };

/** Article du catalogue tel que la conversion le voit, plus son domaine (dit l'espace Cuisine / Bar). */
export type ArticleVente = ArticleDispo & { domaine?: string | null };

/** Consommation d'un article du catalogue par les ventes d'une fiche un jour donné (unité de l'article, texte pleine précision). */
export type ConsoVenteSR = {
  date: string; ficheId: string; ficheNom: string;
  articleStockId: string; designation: string; uniteCatalogue: string | null;
  contenanceCatalogue?: string | null; contenanceUniteCatalogue?: string | null; domaine?: string | null;
  quantite: string;
};

/** Ventes d'une fiche INCOMPLÈTE un jour donné : leurs articles (connus) voient leur théorique « À vérifier ». */
export type VenteAVerifierSR = {
  date: string; ficheId: string; ficheNom: string; quantiteVendue: number;
  articles: { id: string; domaine?: string | null }[];
  /** Raisons lisibles (« Crème : quantité non renseignée »). */
  raisons: string[];
};

export type ConsommationDesVentes = { conso: ConsoVenteSR[]; aVerifier: VenteAVerifierSR[] };

export function consommationDesVentes(
  ventes: readonly VenteSR[], fiches: ReadonlyMap<string, FicheDispo>, articles: ReadonlyMap<string, ArticleVente>,
): ConsommationDesVentes {
  const conso: ConsoVenteSR[] = [];
  const aVerifier: VenteAVerifierSR[] = [];
  const cache = new Map<string, ReturnType<typeof besoinsParPortion> | null>();
  const besoinsDe = (ficheId: string) => {
    if (!cache.has(ficheId)) {
      const f = fiches.get(ficheId);
      cache.set(ficheId, f ? besoinsParPortion(f, { fiches: fiches as Map<string, FicheDispo>, articles: articles as Map<string, ArticleDispo> }) : null);
    }
    return cache.get(ficheId)!;
  };
  for (const v of ventes) {
    if (!Number.isFinite(v.quantite) || v.quantite <= 0) continue; // 0 = « rien vendu » : rien à retirer
    const fiche = fiches.get(v.ficheId);
    const b = besoinsDe(v.ficheId);
    const ficheNom = fiche?.nom ?? "fiche introuvable";
    if (!fiche || !b) {
      aVerifier.push({ date: v.date, ficheId: v.ficheId, ficheNom, quantiteVendue: v.quantite, articles: [], raisons: ["fiche introuvable"] });
      continue;
    }
    for (const [articleId, parPortion] of b.parArticle) {
      const a = articles.get(articleId);
      if (!a) continue;
      conso.push({
        date: v.date, ficheId: v.ficheId, ficheNom, articleStockId: articleId, designation: a.designation, uniteCatalogue: a.unite,
        contenanceCatalogue: a.contenance === null || a.contenance === undefined ? null : String(a.contenance), contenanceUniteCatalogue: a.contenanceUnite ?? null,
        domaine: a.domaine ?? null, quantite: new D(parPortion).times(v.quantite).toString(),
      });
    }
    if (b.incomplet) {
      const ids = new Set<string>([...b.parArticle.keys(), ...b.enCause]);
      aVerifier.push({
        date: v.date, ficheId: v.ficheId, ficheNom, quantiteVendue: v.quantite,
        articles: [...ids].map((id) => ({ id, domaine: articles.get(id)?.domaine ?? null })),
        raisons: b.raisons.map(libelleRaison),
      });
    }
  }
  return { conso, aVerifier };
}
