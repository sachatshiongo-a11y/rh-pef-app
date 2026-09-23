import { describe, it, expect, beforeAll } from "vitest";
import zlib from "node:zlib";
import path from "node:path";
import { genererCodeAffiche } from "@/lib/pointage-code";
import { urlAffiche } from "@/lib/pointage-qr";
import { qrLuSurLaPage } from "@/lib/test/qr-pdf";
import { genererAffichePdf, COTE_QR_PT } from "./affiche-pointage";

/**
 * L'affiche de pointage, relue sur le PDF PRODUIT : son texte, l'absence de toute police de repli
 * (méthode de `glyphes-manquants.test.ts`), la TAILLE du QR imprimé, et surtout ce qu'il contient
 * une fois la page dessinée en pixels : un QR qu'on ne relit pas, ou qui mène ailleurs, ferait
 * une affiche inutile — et chaque salarié l'apprendrait devant la porte.
 */

const CM = 72 / 2.54; // points PDF par centimètre
const LOGO = path.join(process.cwd(), "public/logo-pates-en-folie.png");
const URL_AFFICHE = urlAffiche("https://rh.patesenfolie.cd", genererCodeAffiche());

function policesDuPdf(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
}
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

/** Les flux de contenu décompressés (le texte et les ordres de dessin de la page). */
function fluxDecompresses(pdf: Buffer): string[] {
  const flux: string[] = [];
  let curseur = 0;
  for (;;) {
    const debut = pdf.indexOf("stream", curseur);
    if (debut === -1) break;
    const fin = pdf.indexOf("endstream", debut);
    if (fin === -1) break;
    curseur = fin + "endstream".length;
    let d = debut + "stream".length;
    if (pdf[d] === 0x0d) d++;
    if (pdf[d] === 0x0a) d++;
    try {
      flux.push(zlib.inflateSync(pdf.subarray(d, fin)).toString("latin1"));
    } catch {
      // flux non compressé : sans intérêt ici
    }
  }
  return flux;
}

/** Taille (en points) de chaque image dessinée : la matrice `a b c d e f cm` qui précède `/Nom Do`. */
function imagesDessinees(pdf: Buffer): { largeur: number; hauteur: number }[] {
  const tailles: { largeur: number; hauteur: number }[] = [];
  for (const contenu of fluxDecompresses(pdf)) {
    for (const m of contenu.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\s+\/[A-Za-z0-9]+ Do/g)) {
      tailles.push({ largeur: Math.abs(Number(m[1])), hauteur: Math.abs(Number(m[4])) });
    }
  }
  return tailles;
}

async function texteDu(pdf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(pdf) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

let pdf: Buffer;

beforeAll(async () => {
  pdf = await genererAffichePdf({ url: URL_AFFICHE, logo: LOGO });
}, 60_000);

describe("affiche de pointage (PDF A4)", () => {
  it("porte le titre et les trois consignes", async () => {
    const t = await texteDu(pdf);
    expect(t).toContain("Pointage");
    expect(t).toContain("Ouvrez l'application");
    expect(t).toContain("Appuyez sur Pointer");
    expect(t).toContain("Visez ce code");
    // Le code est un secret de la Direction : il n'est lisible que dans le QR, jamais en clair.
    expect(t).not.toContain(new URL(URL_AFFICHE).searchParams.get("c")!);
  }, 60_000);

  it("tient sur une seule page A4", async () => {
    const { PDFParse } = await import("pdf-parse");
    const info = await new PDFParse({ data: new Uint8Array(pdf) }).getInfo();
    expect(info.total).toBe(1);
  }, 60_000);

  it("n'embarque qu'Optima : aucune police de repli", () => {
    const polices = policesDuPdf(pdf);
    expect(polices.length).toBeGreaterThan(0);
    expect(polices.filter((p) => !estEmbarquee(p))).toEqual([]);
  });

  it("dessine le QR en carré d'au moins 12 cm de côté", () => {
    expect(COTE_QR_PT).toBeGreaterThanOrEqual(12 * CM);
    const qr = imagesDessinees(pdf).filter((i) => i.largeur >= 12 * CM);
    expect(qr).toHaveLength(1);
    expect(qr[0].hauteur).toBeCloseTo(qr[0].largeur, 1);
  });

  it("le QR imprimé se relit, et mène à l'adresse de l'affiche", async () => {
    expect(await qrLuSurLaPage(pdf)).toBe(URL_AFFICHE);
  }, 60_000);
});
