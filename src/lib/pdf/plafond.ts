import { formaterNombre } from "@/lib/montant";

/**
 * PLAFOND DE LIGNES DES PDF TABULAIRES (audit du 10/10/2026, sécurité 2).
 *
 * Un PDF tabulaire coûte ~110 Ko de mémoire vive PAR LIGNE au rendu (mesuré sur l'Atelier le
 * 2026-10-02 : 2 500 lignes = pic 447 Mo, 5 000 lignes = « JavaScript heap out of memory »). Sur
 * l'instance Render de 512 Mo, un seul export trop long fait tomber l'application POUR TOUT LE
 * MONDE (redémarrage forcé, ~3 min de 502). Le plafond est donc une protection de la production,
 * pas une préférence de mise en page.
 *
 * Au-delà, le document est REFUSÉ, jamais TRONQUÉ : un PDF rogné en silence serait un document faux
 * (totaux d'une partie présentés comme ceux de la période). Le refus dit le compte réel et le
 * plafond, et renvoie vers la réduction de période ou l'Excel (l'Excel n'a pas ce coût : 5 000
 * lignes = 63 Mo, 0,3 s).
 *
 * Module PUR (pas de react-pdf) : lisible par un écran comme par une route.
 */
export const PLAFOND_LIGNES_PDF = 1500;

export function messagePdfTropLong(lignes: number, plafond: number = PLAFOND_LIGNES_PDF): string {
  return `Période trop longue : ${formaterNombre(lignes)} lignes, maximum ${formaterNombre(plafond)} pour un PDF — réduisez la période (ou exportez en Excel).`;
}

export class PdfTropLongError extends Error {
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
