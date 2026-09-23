import jsQR from "jsqr";

/** Une zone de la page, en FRACTIONS de sa largeur et de sa hauteur (0 à 1). */
export type ZonePage = { x: number; y: number; largeur: number; hauteur: number };

/**
 * Dessine la première page d'un PDF en pixels, puis la fait lire par jsQR — le même lecteur que le
 * scanner de l'application. `null` si aucun QR ne s'y lit. Réservé aux tests.
 *
 * `zone` restreint la lecture à une partie de la page : sur une page qui porte plusieurs QR (les
 * fiches de connexion, huit par page), jsQR mêle les repères des codes voisins et n'en lit aucun.
 */
export async function qrLuSurLaPage(pdf: Buffer, zone?: ZonePage): Promise<string | null> {
  const { PDFParse } = await import("pdf-parse");
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const { pages } = await new PDFParse({ data: new Uint8Array(pdf) }).getScreenshot({ desiredWidth: 1200, imageDataUrl: false });
  const image = await loadImage(Buffer.from(pages[0].data));
  const z = zone ?? { x: 0, y: 0, largeur: 1, hauteur: 1 };
  const sx = Math.round(z.x * image.width);
  const sy = Math.round(z.y * image.height);
  const w = Math.round(z.largeur * image.width);
  const h = Math.round(z.hauteur * image.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, sx, sy, w, h, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  return jsQR(new Uint8ClampedArray(pixels.data), w, h)?.data ?? null;
}
