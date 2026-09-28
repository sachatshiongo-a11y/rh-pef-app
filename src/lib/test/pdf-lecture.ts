/**
 * Relecture d'un PDF PRODUIT, pour les tests de documents. Réservé aux tests.
 *
 * `policesDeRepli` reprend le garde-fou de `src/lib/pdf/glyphes-manquants.test.ts` (qui prouve,
 * lui, que la méthode voit bien le défaut d'origine) : un document dont tout le texte tient dans
 * Optima n'embarque QUE des sous-ensembles Optima (préfixés « ABCDEF+ ») ; dès qu'un caractère
 * manque à la police, une police standard NON embarquée apparaît.
 */

/** Polices non embarquées du PDF (repli sur une police standard) : doit être vide. */
export function policesDeRepli(pdf: Buffer): string[] {
  const polices = [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
  if (polices.length === 0) throw new Error("Aucune police lue dans le PDF : le contrôle ne prouverait rien.");
  return polices.filter((nom) => !/^[A-Z]{6}\+/.test(nom));
}

/** Texte de chaque page : `lignes` telles qu'extraites, `plat` en une seule ligne (espaces réduits). */
export async function pagesDuPdf(pdf: Buffer): Promise<{ lignes: string[]; plat: string }[]> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(pdf) }).getText();
  return pages.map((p) => ({
    lignes: p.text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean),
    plat: p.text.replace(/\s+/g, " "),
  }));
}
