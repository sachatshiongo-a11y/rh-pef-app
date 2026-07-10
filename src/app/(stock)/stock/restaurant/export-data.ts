import type { JourResto } from "./semaine";

type ArtExport = {
  categorie: string | null;
  designation: string;
  unite: string | null;
  stockBaseJournalier: unknown | null;
  comptages: { date: Date; quantite: unknown }[];
};

const SANS_CAT = "Sans catégorie";

/**
 * Construit les lignes d'export du stock restaurant (Cuisine ou Bar), regroupées par catégorie.
 * Colonnes : Désignation | Unité | Stock base | [7 jours de la semaine]. Retourne aussi les indices
 * des lignes-titres de catégorie (pour les fusionner / mettre en gras dans l'Excel et le PDF).
 */
export function lignesStockResto(articles: ArtExport[], jours: JourResto[]) {
  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  const nbCols = 3 + jours.length;
  let curCat: string | null = null;

  for (const a of articles) {
    const cat = a.categorie ?? SANS_CAT;
    if (cat !== curCat) {
      curCat = cat;
      sectionRows.push(lignes.length);
      lignes.push([cat, ...Array(nbCols - 1).fill("")]);
    }
    const parJour: Record<string, number> = {};
    for (const c of a.comptages) parJour[new Date(c.date).toISOString().slice(0, 10)] = Number(c.quantite);
    lignes.push([
      a.designation,
      a.unite ?? "",
      a.stockBaseJournalier != null ? Number(a.stockBaseJournalier) : "",
      ...jours.map((j) => (j.iso in parJour ? parJour[j.iso] : "")),
    ]);
  }

  return { lignes, sectionRows };
}
