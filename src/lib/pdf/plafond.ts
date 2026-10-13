import { formaterNombre } from "@/lib/montant";
import { ErreurMetier } from "@/lib/erreur-metier";

/**
 * PLAFOND DE LIGNES DES PDF TABULAIRES (audit du 10/10/2026, sécurité 2 ; ABAISSÉ de 1 500 à 300 le 13/10/2026).
 *
 * Un PDF tabulaire est rendu par react-pdf d'UN SEUL BLOC, sans que la boucle d'événements puisse respirer, et son
 * coût croît comme le CARRÉ du nombre de lignes : pour couper un tableau en pages, react-pdf reprend la mise en page
 * de tout ce qui reste à chaque page, et son découpage parcourt les lignes restantes une à une. Mesuré le
 * 13/10/2026 (tableau de 6 colonnes, Node borné à 200 Mo ; blocage = plus long retard de la boucle d'événements ;
 * pic = tas au-dessus de l'état de repos) :
 *
 *     lignes   blocage        pic de tas
 *        100    0,4 s          +26 Mo
 *        300    1,0 s (1)      +62 Mo
 *        500    2,7 s          +53 Mo
 *        800    6,7 s (1)      +86 Mo
 *      1 000   10,2 s          +96 Mo
 *      1 500   25,6 s         +136 Mo
 *   (1) 300 et 800 mesurés machine très chargée (1,6 s et 38 s) ; valeurs au repos déduites de la courbe (blocage
 *       ≈ 1,05 × 10⁻⁵ × lignes² s, ajustée sur 500, 1 000 et 1 500 lignes mesurées au repos).
 *
 * En production, l'inventaire de septembre (plusieurs centaines d'articles) a bloqué l'instance plus de 5 secondes :
 * le contrôle de santé de Render a échoué, l'instance de 512 Mo a été déclarée en panne et redémarrée (~3 min de 502
 * pour TOUT LE MONDE). Ce qui limite est le TEMPS de blocage bien plus que la mémoire (1 500 lignes tiennent dans
 * 200 Mo) : l'ancien plafond de 1 500 lignes laissait passer 25 secondes d'arrêt.
 *
 * 300 lignes = ~1 s de blocage sur la machine de développement. L'instance de production est plus lente (hypothèse :
 * l'incident a eu lieu à quelques centaines d'articles, soit ~2 s ici contre 5 s de délai, donc au moins 2,5 fois) :
 * 300 lignes laissent une marge d'environ 2 contre le délai de 5 s du contrôle de santé.
 * Plus long : l'EXCEL (5 000 lignes = 63 Mo, 0,3 s, aucun blocage).
 *
 * Au-delà, le document est REFUSÉ, jamais TRONQUÉ : un PDF rogné en silence serait un document faux
 * (totaux d'une partie présentés comme ceux de la période). Le refus dit le compte réel et le plafond, et renvoie
 * vers la réduction de période ou l'Excel.
 *
 * Module PUR (pas de react-pdf) : lisible par un écran comme par une route.
 */
export const PLAFOND_LIGNES_PDF = 300;

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
