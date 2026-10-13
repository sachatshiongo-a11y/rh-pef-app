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

/** Un morceau de texte posé sur une page : `y` = distance au HAUT de la page, en points ;
 *  `taille` = corps du texte en points (lu dans la matrice de texte) ; `largeur` = largeur dessinée. */
export type TextePose = { page: number; texte: string; x: number; y: number; taille: number; largeur: number };

/**
 * Textes du PDF avec leur POSITION : permet de vérifier la mise en page, pas seulement le texte
 * (des rangées écrasées les unes sur les autres gardent tout leur texte, mais plus leur place).
 */
export async function textesPoses(pdf: Buffer): Promise<TextePose[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, isEvalSupported: false }).promise;
  const sortie: TextePose[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const hauteur = page.getViewport({ scale: 1 }).height;
    const { items } = await page.getTextContent();
    for (const it of items) {
      if (!("str" in it) || !it.str.trim()) continue;
      sortie.push({ page: n, texte: it.str.trim(), x: it.transform[4], y: hauteur - it.transform[5], taille: Math.hypot(it.transform[2], it.transform[3]), largeur: it.width });
    }
  }
  await doc.destroy();
  return sortie;
}

/**
 * Plus petit écart vertical entre deux rangées CONSÉCUTIVES d'un tableau, sur chaque page :
 * `repere` reconnaît le texte de la 1re colonne de chaque rangée (une date, un libellé…).
 * Un tableau lisible a des rangées espacées d'au moins la hauteur de sa police ; un tableau
 * écrasé (bloc insécable trop haut pour la page) tombe à quelques points, voire zéro.
 */
export function ecartMinimalEntreRangees(textes: TextePose[], repere: RegExp): number {
  const parPage = new Map<number, number[]>();
  for (const t of textes) if (repere.test(t.texte)) parPage.set(t.page, [...(parPage.get(t.page) ?? []), t.y]);
  let min = Infinity;
  for (const ys of parPage.values()) {
    // Sans dédoublonner : deux rangées posées au MÊME endroit donnent un écart nul, pas un point.
    const tries = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < tries.length; i++) min = Math.min(min, tries[i] - tries[i - 1]);
  }
  return min;
}

/**
 * Pages d'un PDF qui diffèrent VISUELLEMENT d'un autre : rastérise chaque page (pdfjs + @napi-rs/canvas, échelle 1) et compte
 * les pixels dont la couleur diffère nettement. Voit ce que la position du texte ne dit pas : traits, fonds, marges.
 * Renvoie, par page, le nombre de pixels différents (0 = identique ; quelques pixels de lissage sont normaux).
 */
export async function pixelsDifferentsParPage(a: Buffer, b: Buffer, echelle = 1): Promise<number[]> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const ouvrir = (pdf: Buffer) => pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, isEvalSupported: false }).promise;
  const [da, db] = [await ouvrir(a), await ouvrir(b)];
  if (da.numPages !== db.numPages) throw new Error(`Pages différentes : ${da.numPages} contre ${db.numPages}`);
  const pixels = async (doc: typeof da, n: number) => {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: echelle });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never }).promise;
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const sortie: number[] = [];
  for (let n = 1; n <= da.numPages; n++) {
    const [pa, pb] = [await pixels(da, n), await pixels(db, n)];
    let diff = 0;
    for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 60) diff++;
    sortie.push(diff);
  }
  await Promise.all([da.destroy(), db.destroy()]);
  return sortie;
}
