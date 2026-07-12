// Analyse de l'évolution du prix d'achat d'un article, à partir des lignes de facture.
// Partagé entre la fiche article (écran) et son export PDF — logique unique, pas de duplication.

/** Au-delà de ce % au-dessus de la moyenne des achats précédents, on signale une hausse anormale. */
export const SEUIL_HAUSSE_PRIX = 15;

export type PointPrix = { date: Date; prix: number; qte: number; factureId: string; numero: string | null };

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
