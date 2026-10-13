import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pieceLigneDate, pieceTableauFiche, stylePageFiche, type ColonneFiche, type RangeeFiche } from "./fiche-a-remplir";
import { verifierPlafondPdf } from "./plafond";
import { documentDuPlan } from "./blocs";
import { formaterNombre } from "@/lib/montant";
import { ENTETE_FICHE } from "@/app/(stock)/stock/reconciliation/fiche/comptage-data";

registerPdfFonts();

/**
 * Fiche de comptage VIERGE en PDF (Stock → Réconciliation), à imprimer et remplir à la main. Même contenu que la
 * fiche Excel : les mêmes colonnes (`ENTETE_FICHE`), les mêmes lignes (`lignesFicheComptage`), articles groupés par
 * catégorie ; Physique et Écart restent vides. A4, ligne d'en-tête répétée sur chaque page, rangées insécables
 * (briques de `fiche-a-remplir.tsx`).
 */
export const COLONNES_FICHE_COMPTAGE: ColonneFiche[] = [
  { entete: ENTETE_FICHE[0], largeur: "35%" },
  { entete: ENTETE_FICHE[1], largeur: "19%" },
  { entete: ENTETE_FICHE[2], largeur: "10%" },
  { entete: ENTETE_FICHE[3], largeur: "12%", align: "right" },
  { entete: ENTETE_FICHE[4], largeur: "12%", align: "center" },
  { entete: ENTETE_FICHE[5], largeur: "12%", align: "center" },
];

/**
 * Rangées du PDF à partir des lignes de la fiche Excel : une ligne-titre (`sectionRows`) devient une rubrique, les
 * autres des articles dont le Théorique est formaté en fr-FR (`formaterNombre` : jamais l'espace fine insécable,
 * absente d'Optima) et dont Physique et Écart restent vides.
 */
export function rangeesFicheComptage(lignes: (string | number)[][], sectionRows: number[]): RangeeFiche[] {
  const titres = new Set(sectionRows);
  return lignes.map((l, i): RangeeFiche =>
    titres.has(i)
      ? { rubrique: String(l[0]) }
      : { cellules: [String(l[0]), String(l[1] ?? ""), String(l[2] ?? ""), typeof l[3] === "number" ? formaterNombre(l[3], { maximumFractionDigits: 3 }) : String(l[3] ?? ""), "", ""] },
  );
}

export function FicheComptageDocument({ titre, sousTitre, rangees }: { titre: string; sousTitre: string; rangees: RangeeFiche[] }): ReactElement<DocumentProps> {
  verifierPlafondPdf(rangees.length); // refus AVANT rendu au-delà du plafond (lib/pdf/plafond.ts)
  const pieces = [pieceLigneDate, pieceTableauFiche(COLONNES_FICHE_COMPTAGE, rangees, 18)];
  return documentDuPlan({
    mode: "fenetres",
    titre,
    groupes: [{ entete: <PdfHeader title={titre} subtitle={sousTitre} />, pieces }],
    page: { orientation: "portrait", style: stylePageFiche },
    pied: <PdfFooter docLabel={`${titre} — ${sousTitre}`} />,
    places: pieces.reduce((n, p) => n + p.places, 0),
  });
}
