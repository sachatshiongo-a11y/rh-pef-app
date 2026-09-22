import { describe, it, expect } from "vitest";
import { decoderTrace } from "./signature";

// `decoderTrace` est la SEULE barrière entre ce que le navigateur prétend envoyer (un PNG) et ce
// qui atterrit dans le bucket de stockage. Ne jamais faire confiance à la déclaration
// `data:image/...` : on vérifie l'en-tête PNG octet par octet.

const ENTETE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Construit un faux PNG plausible (en-tête correct + remplissage) de la taille demandée. */
function pngDeTaille(octets: number): string {
  const buf = Buffer.concat([ENTETE_PNG, Buffer.alloc(Math.max(octets - ENTETE_PNG.length, 0), 0x00)]);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

describe("decoderTrace", () => {
  it("un PNG plausible (en-tête correct, taille raisonnable) passe", () => {
    const buf = decoderTrace(pngDeTaille(200));
    expect(buf.subarray(0, 8).equals(ENTETE_PNG)).toBe(true);
    expect(buf.length).toBe(200);
  });

  it("un data:image/svg+xml est refusé, même avec un contenu valide en base64", () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64");
    expect(() => decoderTrace(`data:image/svg+xml;base64,${svg}`)).toThrow("Signature illisible.");
  });

  it("un base64 quelconque (mauvais en-tête) est refusé", () => {
    const quelconque = Buffer.alloc(150, 0x41).toString("base64"); // 150 octets de 'A', pas un en-tête PNG
    expect(() => decoderTrace(`data:image/png;base64,${quelconque}`)).toThrow("Signature illisible.");
  });

  it("un tracé trop court est refusé (même avec un bon en-tête)", () => {
    expect(() => decoderTrace(pngDeTaille(50))).toThrow("Signature illisible.");
  });

  it("un PNG de plus de 400 ko est refusé", () => {
    expect(() => decoderTrace(pngDeTaille(450_000))).toThrow("Signature trop lourde.");
  });
});
