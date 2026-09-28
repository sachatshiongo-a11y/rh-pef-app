import { Document, Page } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { LigneDate, TableauFiche, stylePageFiche, type ColonneFiche, type RangeeFiche } from "./fiche-a-remplir";

registerPdfFonts();

/**
 * Fiches d'inventaire du restaurant, Cuisine et Bar (modèle remis par la Direction, 2026-09-28) :
 * date à remplir, titre, lignes de rubrique par catégorie, puis Désignation | Unité (Cuisine) ou
 * Catégorie (Bar) | Stock | Commentaire, les deux dernières colonnes vides, à remplir à la main.
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
      { entete: "Désignation", largeur: "38%" },
      { entete: "Catégorie", largeur: "22%" },
      { entete: "Stock restaurant", largeur: "16%", align: "center" },
      { entete: "Commentaire", largeur: "24%" },
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
    const deuxieme = espace === "CUISINE" ? a.unite?.trim() ?? "" : categorie === SANS_CATEGORIE ? "" : categorie;
    rangees.push({ cellules: [a.designation, deuxieme, "", ""] });
  }
  return rangees;
}

/** Une fiche par espace demandé, chacune commençant sur une nouvelle page. */
export function FichesInventaireDocument({ fiches }: { fiches: { espace: EspaceFiche; articles: ArticleFiche[] }[] }) {
  return (
    <Document title={fiches.map((f) => FICHES_INVENTAIRE[f.espace].titre).join(" + ")}>
      {fiches.map(({ espace, articles }) => {
        const { titre, colonnes } = FICHES_INVENTAIRE[espace];
        const rangees = rangeesFicheInventaire(espace, articles);
        return (
          <Page key={espace} size="A4" style={stylePageFiche}>
            <PdfHeader title={titre} subtitle="Quantités comptées à écrire à la main" />
            <LigneDate />
            <TableauFiche colonnes={colonnes} rangees={rangees} hauteurRangee={18} />
            <PdfFooter docLabel={titre} />
          </Page>
        );
      })}
    </Document>
  );
}
