/**
 * Mise en page de la fiche « Achat de légumes Marché » : celle de l'onglet « Achat légumes » du
 * classeur de la Direction (assets/modeles/achat-legumes.xlsx), telle qu'Excel l'imprime.
 *
 * Valeurs du CLASSEUR (relues et comparées par fiche-achat-legumes.fidelite.test.ts) :
 *  - police Optima, GRAS partout, corps 14 ; noir sur blanc, aucun fond ;
 *  - colonnes B à E : 25,5 | 11,83 | 21,16 | 15 unités, précédées de la colonne A (10,83) ;
 *  - rangées : 19 par défaut, 21 pour le titre, 20 pour l'en-tête et la première rangée ;
 *  - A4 portrait, marges 0,7 po (côtés) et 0,75 po (haut et bas), « Ajuster » sur 1 page ;
 *  - logo à l'angle de la colonne B, 163,7 x 56 pt ; « Date : » sur la colonne D ;
 *  - cadre épais autour du titre et du tableau, traits pointillés à l'intérieur ;
 *  - sous le tableau : « Montant donné $ » (B), « Montant total CDF » et « Montant total $ » (D),
 *    les cases à remplir étant les cellules vides voisines (C et E), sans cadre.
 *
 * Mesures de l'IMPRESSION d'Excel (Mac, 2026-10-12, PDF du classeur relu avec pdf.js) : une unité de
 * largeur de colonne s'imprime 6,0 pt avant l'échelle, une rangée à 0,895 de sa hauteur, et l'échelle
 * d'Excel (89 % pour les 38 légumes) est celle de l'ajustement à la page, tronquée au pour cent.
 */

export const UNITES_COLONNES = { gauche: 10.83203125, libelle: 25.5, unite: 11.83203125, quantite: 21.1640625, montant: 15 } as const;
export const POLICE = 14;
export const RANGEE = { defaut: 19, titre: 21, entete: 20, premiere: 20 } as const;
export const PT_PAR_UNITE = 6.0;
export const FACTEUR_RANGEE = 0.895;
export const A4 = { largeur: 595.2756, hauteur: 841.8898 };
/** Marges du classeur, en points (0,7 po côtés, 0,75 po haut et bas). */
export const MARGES = { cotes: 0.7 * 72, hautBas: 0.75 * 72 };
/** Logo : taille du dessin dans le classeur (2 078 538 x 711 200 EMU), en points. */
export const LOGO = { largeur: 2078538 / 12700, hauteur: 711200 / 12700 };
/** Plancher de l'échelle : au-delà, la fiche passe à la page suivante (en-tête répété) plutôt que d'imprimer illisible. */
export const ECHELLE_MIN = 0.7;
/** Les trois blocs sous le tableau : une rangée vide puis deux rangées (« Montant total CDF » / « Montant total $ »). */
const RANGEES_SOUS_TABLEAU = 3;
/** Les six rangées avant l'en-tête : logo (2), date, vide, titre, vide. */
const RANGEES_AVANT = [RANGEE.defaut, RANGEE.defaut, RANGEE.defaut, RANGEE.defaut, RANGEE.titre, RANGEE.defaut];

/** Mention sous les totaux (hors modèle) : corps et interligne, en points, non mis à l'échelle. */
export const NOTE = { police: 8, interligne: 1.25, marge: 5 } as const;
/** Estimation prudente du nombre de lignes d'une note (≈ 95 caractères par ligne à ce corps sur la largeur du tableau). */
export const lignesDeNote = (texte: string) => Math.max(1, Math.ceil(texte.length / 95));

export type MesuresFiche = {
  echelle: number;
  police: number;
  /** Largeur en points de la colonne A puis des colonnes B à E. */
  gauche: number;
  colonnes: [number, number, number, number];
  tableau: number;
  /** Hauteur imprimée d'une rangée de hauteur nominale `n`. */
  h: (n: number) => number;
  /** Épaisseur du cadre épais et des traits pointillés. */
  epais: number;
  fin: number;
  /** Marge de texte à gauche d'une case (celle d'Excel : 1,5 pt à l'échelle, plus 0,5). */
  marge: number;
};

/**
 * Échelle et mesures d'une fiche de `nbLignes` légumes : comme Excel avec « Ajuster à 1 page » —
 * largeur et hauteur du classeur ramenées à la page, tronquées au pour cent, jamais agrandies. Les
 * notes (hors modèle) retirent leur place à la hauteur disponible : elles ne débordent pas sur
 * une seconde page quand le tableau, lui, tient.
 */
export function mesuresFiche(nbLignes: number, hauteurNotes = 0): MesuresFiche {
  const unites = [UNITES_COLONNES.libelle, UNITES_COLONNES.unite, UNITES_COLONNES.quantite, UNITES_COLONNES.montant] as const;
  const nominalCorps = nbLignes > 0 ? RANGEE.premiere + (nbLignes - 1) * RANGEE.defaut : 0;
  const nominal = RANGEES_AVANT.reduce((t, n) => t + n, 0) + RANGEE.entete + nominalCorps + RANGEES_SOUS_TABLEAU * RANGEE.defaut;
  const largeurUtile = A4.largeur - 2 * MARGES.cotes;
  const hauteurUtile = A4.hauteur - 2 * MARGES.hautBas - hauteurNotes;
  const toutesUnites = UNITES_COLONNES.gauche + unites.reduce((t, u) => t + u, 0);
  const brut = Math.min(1, largeurUtile / (toutesUnites * PT_PAR_UNITE), hauteurUtile / (nominal * FACTEUR_RANGEE));
  const echelle = Math.max(ECHELLE_MIN, Math.floor(brut * 100) / 100);
  const colonnes = unites.map((u) => u * PT_PAR_UNITE * echelle) as [number, number, number, number];
  return {
    echelle,
    police: POLICE * echelle,
    gauche: UNITES_COLONNES.gauche * PT_PAR_UNITE * echelle,
    colonnes,
    tableau: colonnes.reduce((t, c) => t + c, 0),
    h: (n) => n * FACTEUR_RANGEE * echelle,
    epais: 2 * echelle,
    fin: 0.5,
    marge: 1.5 * echelle + 0.5,
  };
}
