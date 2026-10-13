import { formaterNombre } from "@/lib/montant";
import { ErreurMetier } from "@/lib/erreur-metier";

/**
 * PLAFOND DE LIGNES DES PDF TABULAIRES (audit du 10/10/2026, sécurité 2 ; 1 500 → 300 le 13/10/2026 ; 300 → 600 le 13/10/2026
 * avec le rendu PAR BLOCS, voir `blocs.tsx`).
 *
 * LE CRITÈRE A CHANGÉ. Un PDF tabulaire était rendu d'un seul bloc dont le coût croît comme le CARRÉ du nombre de lignes : ce
 * qui limitait était le BLOCAGE de la boucle d'événements (le contrôle de santé de Render échoue au-delà de 5 s ; l'inventaire
 * de septembre a fait redémarrer l'instance, ~3 min de 502 pour TOUT LE MONDE). Rendu par fenêtres de deux pages, le blocage
 * est celui d'une fenêtre (≤ 0,3 s en local, quel que soit le nombre de lignes), la mémoire reste plate, et le coût devient
 * LINÉAIRE. Ce qui limite désormais est le TEMPS TOTAL de la réponse (et la taille du fichier : ~0,8 Mo pour 600 lignes, chaque
 * fenêtre embarquant son sous-ensemble de police et le logo).
 *
 * Mesuré le 13/10/2026 (tableau de 6 colonnes, Node borné à 200 Mo ; machine de développement partagée, charge de 6 à 13 sur 8
 * cœurs, meilleur de 3 passages ; blocage = plus long retard de la boucle d'événements ; pic = tas avant ramasse-miettes) :
 *
 *               AVANT (un seul bloc)             APRÈS (par blocs)
 *     lignes   total   blocage   pic de tas     total   blocage   pic de tas
 *        100   0,6 s    0,4 s      62 Mo         0,8 s    0,22 s     68 Mo
 *        300   1,9 s    1,6 s      93 Mo         1,8 s    0,22 s     73 Mo
 *        600   4,6 s    4,0 s     131 Mo         1,9 à 3,2 s  0,15 à 0,22 s  73 Mo
 *      1 000  10,8 s    9,9 s     165 Mo         4,1 s    0,19 s     78 Mo
 *      1 500  ≈ 25 s  ≈ 25 s     ≈ 190 Mo       5,6 s    0,19 s     74 Mo
 *   (AVANT à 1 500 : mesure de l'audit ; la courbe est quadratique, ≈ 1,05 × 10⁻⁵ × lignes² s au repos.)
 *
 * Coût par blocs ≈ 3 à 5 ms par ligne selon la charge de la machine. L'instance gratuite de Render (0,1 vCPU) est environ 10 fois
 * plus lente que la machine de développement : la cible est un temps total de réponse ≤ 30 s, soit ≈ 3 s en local. 600 lignes
 * (1,9 s près du repos, 3,2 s sous charge) la tiennent avec de la marge ; 800 la frôleraient (2,7 à 4,1 s) et 1 000 la dépasseraient.
 * Au-delà, l'utilisateur attendrait trop et le téléchargement risquerait l'abandon : l'EXCEL (5 000 lignes = 63 Mo, 0,3 s) est
 * l'outil du gros volume.
 *
 * Au-delà, le document est REFUSÉ, jamais TRONQUÉ : un PDF rogné en silence serait un document faux (totaux d'une partie présentés
 * comme ceux de la période). Le refus dit le compte réel et le plafond, et renvoie vers la réduction de période ou l'Excel.
 *
 * Module PUR (pas de react-pdf) : lisible par un écran comme par une route.
 */
export const PLAFOND_LIGNES_PDF = 600;

export function messagePdfTropLong(lignes: number, plafond: number = PLAFOND_LIGNES_PDF): string {
  return `Période trop longue : ${formaterNombre(lignes)} lignes, maximum ${formaterNombre(plafond)} pour un PDF — réduisez la période (ou exportez en Excel).`;
}

export class PdfTropLongError extends ErreurMetier {
  readonly lignes: number;
  readonly plafond: number;
  constructor(lignes: number, plafond: number = PLAFOND_LIGNES_PDF) {
    super(messagePdfTropLong(lignes, plafond));
    this.name = "PdfTropLongError";
    this.lignes = lignes;
    this.plafond = plafond;
  }
}

/** Lève `PdfTropLongError` AVANT tout rendu si le document dépasse le plafond. */
export function verifierPlafondPdf(lignes: number, plafond: number = PLAFOND_LIGNES_PDF): void {
  if (lignes > plafond) throw new PdfTropLongError(lignes, plafond);
}

/** Réponse 413 lisible (texte brut, affiché tel quel par `TelechargerLien`) ; `null` si l'erreur est d'une autre nature. */
export function reponsePdfTropLong(e: unknown): Response | null {
  if (!(e instanceof PdfTropLongError)) return null;
  return new Response(e.message, { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
