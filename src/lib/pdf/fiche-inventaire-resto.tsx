import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pieceLigneDate, pieceTableauFiche, stylePageFiche, type ColonneFiche, type RangeeFiche } from "./fiche-a-remplir";
import { verifierPlafondPdf } from "./plafond";
import { documentDuPlan, totalPlaces, type Groupe } from "./blocs";

registerPdfFonts();

/**
 * Fiches d'inventaire du restaurant, Cuisine et Bar (modèle remis par la Direction, 2026-09-28) :
 * date à remplir, titre, lignes de rubrique par catégorie, puis Désignation | Unité | Stock |
 * Commentaire (Cuisine) ou Désignation | Stock | Commentaire (Bar : la catégorie est déjà la ligne de
 * rubrique, la répéter en colonne était redondant — retirée à la demande de la Direction, 2026-09-28).
 * Stock et Commentaire restent vides, à remplir à la main.
 *
 * Les articles sont ceux de l'application (ArticleResto actifs), dans l'ordre et avec les
 * catégories de l'écran « Stock restaurant » — jamais la liste figée du classeur.
 */

export type EspaceFiche = "CUISINE" | "BAR";
export type ArticleFiche = { designation: string; unite: string | null; categorie: string | null; actif: boolean };

export const SANS_CATEGORIE = "Sans catégorie";

export const FICHES_INVENTAIRE: Record<EspaceFiche, { titre: string; colonnes: ColonneFiche[] }> = {
  CUISINE: {
    titre: "Fiche d'inventaire Cuisine",
    colonnes: [
      { entete: "Désignation", largeur: "44%" },
      { entete: "Unité", largeur: "12%" },
      { entete: "Stock cuisine", largeur: "18%", align: "center" },
      { entete: "Commentaire", largeur: "26%" },
    ],
  },
  BAR: {
    titre: "Fiche d'inventaire Bar Boissons",
    colonnes: [
      { entete: "Désignation", largeur: "52%" },
      { entete: "Stock restaurant", largeur: "20%", align: "center" },
      { entete: "Commentaire", largeur: "28%" },
    ],
  },
};

/**
 * Rangées d'une fiche : une rubrique à chaque changement de catégorie (dans l'ordre reçu), puis
 * les articles ACTIFS — un article désactivé n'a rien à faire sur une fiche de comptage, même si
 * l'appelant l'a laissé passer. Stock et Commentaire restent vides : on les écrit à la main.
 */
export function rangeesFicheInventaire(espace: EspaceFiche, articles: ArticleFiche[]): RangeeFiche[] {
  const rangees: RangeeFiche[] = [];
  let categorieCourante: string | null = null;
  for (const a of articles) {
    if (!a.actif) continue;
    const categorie = a.categorie?.trim() || SANS_CATEGORIE;
    if (categorie !== categorieCourante) {
      rangees.push({ rubrique: categorie });
      categorieCourante = categorie;
    }
    rangees.push({ cellules: espace === "CUISINE" ? [a.designation, a.unite?.trim() ?? "", "", ""] : [a.designation, "", ""] });
  }
  return rangees;
}

/** Une fiche par espace demandé, chacune commençant sur une nouvelle page. */
export function FichesInventaireDocument({ fiches }: { fiches: { espace: EspaceFiche; articles: ArticleFiche[] }[] }): ReactElement<DocumentProps> {
  const parFiche = fiches.map(({ espace, articles }) => ({ espace, rangees: rangeesFicheInventaire(espace, articles) }));
  verifierPlafondPdf(parFiche.reduce((n, f) => n + f.rangees.length, 0)); // toutes les fiches du document comptent
  const groupes = parFiche.map(({ espace, rangees }): Groupe => {
    const { titre, colonnes } = FICHES_INVENTAIRE[espace];
    return {
      entete: <PdfHeader title={titre} subtitle="Quantités comptées à écrire à la main" />,
      pieces: [pieceLigneDate, pieceTableauFiche(colonnes, rangees, 18)],
      pied: <PdfFooter docLabel={titre} />, // le libellé du pied est celui de la fiche
    };
  });
  return documentDuPlan({
    mode: "fenetres",
    titre: fiches.map((f) => FICHES_INVENTAIRE[f.espace].titre).join(" + "),
    groupes,
    page: { orientation: "portrait", style: stylePageFiche },
    pied: null,
    places: totalPlaces(groupes),
  });
}
