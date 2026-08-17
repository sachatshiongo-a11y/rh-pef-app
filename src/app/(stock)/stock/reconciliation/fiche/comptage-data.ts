import { DOMAINE_LABEL } from "@/lib/stock";

type ArtFiche = {
  domaine: string;
  designation: string;
  unite: string | null;
  categorie: { nom: string } | null;
  fournisseur: { nom: string } | null;
  stock: { quantite: unknown } | null;
};

const SANS_CAT = "Sans catégorie";

export const ENTETE_FICHE = ["Désignation", "Fournisseur", "Unité", "Théorique", "Physique", "Écart"];

/**
 * Construit les lignes de la fiche de comptage regroupées par domaine (uniquement en vue « tous
 * domaines ») puis par catégorie — comme les catalogues. Colonnes : Désignation | Fournisseur |
 * Unité | Théorique | Physique | Écart. Retourne aussi les indices des lignes-titres de section.
 */
export function lignesFicheComptage(articles: ArtFiche[], filtreDomaine: boolean) {
  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  let curDom: string | null = null;
  let curCat: string | null = null;

  for (const a of articles) {
    if (!filtreDomaine && a.domaine !== curDom) {
      curDom = a.domaine;
      curCat = null;
      sectionRows.push(lignes.length);
      lignes.push([(DOMAINE_LABEL[a.domaine] ?? a.domaine).toUpperCase(), "", "", "", "", ""]);
    }
    const cat = a.categorie?.nom ?? SANS_CAT;
    if (cat !== curCat) {
      curCat = cat;
      sectionRows.push(lignes.length);
      lignes.push([cat, "", "", "", "", ""]);
    }
    lignes.push([a.designation, a.fournisseur?.nom ?? "", a.unite ?? "", a.stock ? Number(a.stock.quantite) : 0, "", ""]);
  }

  return { lignes, sectionRows };
}
