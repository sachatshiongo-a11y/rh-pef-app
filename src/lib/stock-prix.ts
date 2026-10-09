// Analyse de l'évolution du prix d'achat d'un article, à partir des lignes de facture ET des
// entrées payées de la liste d'achat (achats sans facture — un achat quand même : leur montant
// compte dans l'évolution du prix). Partagé entre la fiche article, le catalogue et l'export PDF.

/** Au-delà de ce % au-dessus de la moyenne des achats précédents, on signale une hausse anormale. */
export const SEUIL_HAUSSE_PRIX = 15;

/**
 * `prix` : en dollars (les analyses comparent des dollars, comme avant). `prixCDF` : le prix SAISI en
 * francs d'une ligne de facture en francs (2026-10-09), dont `prix` est l'équivalent au taux figé de
 * son enregistrement (« ≈ ») — comme un achat en francs de la Liste d'achat.
 */
export type PointPrix = { date: Date; prix: number; qte: number; factureId: string | null; numero: string | null; prixCDF?: number };

/** Entrée payée hors facture (liste d'achat, mouvement manuel avec montant). */
export type MouvementPrix = { articleId: string | null; montantUSD: unknown; quantite: unknown; date: Date; origine: string | null };

/** Convertit une entrée payée en point de prix (prix unitaire = montant ÷ quantité). */
export function pointDeMouvement(m: MouvementPrix): PointPrix | null {
  const qte = Number(m.quantite);
  const montant = Number(m.montantUSD);
  if (!(qte > 0) || !(montant > 0)) return null;
  return { date: m.date, prix: montant / qte, qte, factureId: null, numero: m.origine ?? "Liste d'achat" };
}

export type AnalysePrix = {
  points: PointPrix[]; // triés du plus ancien au plus récent
  min: number | null;
  max: number | null;
  dernier: PointPrix | null;
  precedent: PointPrix | null;
  variation: number | null; // % du dernier prix vs achat précédent
  moyenneAnterieure: number | null; // moyenne des prix AVANT le dernier achat
  hausse: { pct: number; moyenneAnterieure: number; prix: number } | null; // hausse anormale détectée
};

/**
 * Ligne de facture brute (avec la date de sa facture) telle que lue en base. Facture en francs
 * (2026-10-09) : `prixUnitaireUSD` est NUL, le prix est `prixUnitaireCDF` et le taux figé à
 * l'enregistrement est `facture.tauxChangeUtilise`.
 */
export type LignePrix = {
  articleId: string | null; prixUnitaireUSD: unknown; prixUnitaireCDF?: unknown; quantite: unknown;
  facture: { id: string; numero: string | null; date: Date | null; tauxChangeUtilise?: unknown };
};

/**
 * Point de prix d'une ligne de facture : en dollars tel quel ; en francs, francs ÷ taux figé à
 * l'enregistrement de la facture (fait passé au taux de son jour, « ≈ »). Sans prix, sans date, ou
 * en francs sans taux : null — jamais un point à 0 (qui fabriquerait une « hausse » ou un minimum faux).
 */
export function pointDeLigne(l: LignePrix): PointPrix | null {
  if (!l.facture.date) return null;
  const qte = Number(l.quantite);
  if (l.prixUnitaireUSD !== null && l.prixUnitaireUSD !== undefined) {
    return { date: l.facture.date, prix: Number(l.prixUnitaireUSD), qte, factureId: l.facture.id, numero: l.facture.numero };
  }
  const fc = l.prixUnitaireCDF === null || l.prixUnitaireCDF === undefined ? null : Number(l.prixUnitaireCDF);
  const taux = Number(l.facture.tauxChangeUtilise ?? 0);
  if (fc === null || !(fc > 0) || !(taux > 0)) return null;
  return { date: l.facture.date, prix: fc / taux, qte, factureId: l.facture.id, numero: l.facture.numero, prixCDF: fc };
}

/**
 * Regroupe des lignes de facture par article et renvoie, pour chaque article dont le dernier achat
 * grimpe anormalement, le pourcentage de hausse. Utilisé par le catalogue pour badger les articles.
 */
export function articlesEnHausse(lignes: LignePrix[], mouvementsPayes: MouvementPrix[] = []): Map<string, number> {
  const parArticle = new Map<string, PointPrix[]>();
  for (const l of lignes) {
    if (!l.articleId) continue;
    const p = pointDeLigne(l);
    if (!p) continue;
    const arr = parArticle.get(l.articleId) ?? [];
    arr.push(p);
    parArticle.set(l.articleId, arr);
  }
  for (const m of mouvementsPayes) {
    if (!m.articleId) continue;
    const p = pointDeMouvement(m);
    if (!p) continue;
    const arr = parArticle.get(m.articleId) ?? [];
    arr.push(p);
    parArticle.set(m.articleId, arr);
  }
  const res = new Map<string, number>();
  for (const [articleId, pts] of parArticle) {
    const h = analyserPrix(pts).hausse;
    if (h) res.set(articleId, h.pct);
  }
  return res;
}

export function analyserPrix(points: PointPrix[]): AnalysePrix {
  const tri = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const vals = tri.map((p) => p.prix);
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const dernier = tri.at(-1) ?? null;
  const precedent = tri.length >= 2 ? tri.at(-2)! : null;
  const variation = dernier && precedent && precedent.prix > 0 ? ((dernier.prix - precedent.prix) / precedent.prix) * 100 : null;

  const anterieurs = tri.slice(0, -1).map((p) => p.prix);
  const moyenneAnterieure = anterieurs.length ? anterieurs.reduce((a, b) => a + b, 0) / anterieurs.length : null;
  const hausse =
    dernier && moyenneAnterieure !== null && moyenneAnterieure > 0 && dernier.prix > moyenneAnterieure * (1 + SEUIL_HAUSSE_PRIX / 100)
      ? { pct: ((dernier.prix - moyenneAnterieure) / moyenneAnterieure) * 100, moyenneAnterieure, prix: dernier.prix }
      : null;

  return { points: tri, min, max, dernier, precedent, variation, moyenneAnterieure, hausse };
}
