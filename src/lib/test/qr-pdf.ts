import jsQR from "jsqr";

/**
 * Dessine la première page d'un PDF en pixels, puis la fait lire par jsQR — le même lecteur que le
 * scanner de l'application. `null` si aucun QR ne s'y lit. Réservé aux tests.
 */
export async function qrLuSurLaPage(pdf: Buffer): Promise<string | null> {
  const { PDFParse } = await import("pdf-parse");
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const { pages } = await new PDFParse({ data: new Uint8Array(pdf) }).getScreenshot({ desiredWidth: 1200, imageDataUrl: false });
  const image = await loadImage(Buffer.from(pages[0].data));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  return jsQR(new Uint8ClampedArray(pixels.data), image.width, image.height)?.data ?? null;
}
