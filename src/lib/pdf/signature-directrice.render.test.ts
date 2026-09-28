import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DonneesAttestation } from "@/lib/attestations-donnees";

/**
 * LA SIGNATURE DE LA DIRECTION NE SE TÉLÉCHARGE PAS — ELLE S'IMPRIME.
 *
 * Jusqu'au 2026-09-28, elle vivait dans `public/signatures/` : servie à qui la demandait, SANS
 * session (le proxy exclut les `*.png`). Elle est désormais lue par `fs`, côté serveur, depuis
 * `assets/signatures/`. On vérifie :
 *  1. qu'aucun fichier de `public/` ne porte de signature ;
 *  2. que le chemin utilisé par les PDF est hors de `public/` et que le fichier y est bien ;
 *  3. que les Paramètres sans signature téléversée retombent sur CE fichier ;
 *  4. qu'un rendu RÉEL d'attestation embarque bien CETTE image (mêmes dimensions que le PNG) —
 *     sans quoi le déplacement aurait pu « réussir » en retirant la signature des documents.
 */
vi.mock("@/lib/prisma", () => ({ prisma: { paramEntreprise: { findUnique: async () => null } } }));

const { SIGNATURE_DIRECTRICE_PATH, signatureDirectriceDisponible } = await import("./layout");
const { chargerEntreprise } = await import("@/lib/entreprise");
const { renderPdfBuffer } = await import("./fonts");
const { AttestationDocument } = await import("./attestation");

const RACINE = process.cwd();

function fichiers(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiers(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

/** Largeur × hauteur lues dans l'en-tête IHDR du PNG. */
function dimensionsPng(buf: Buffer): { l: number; h: number } {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { l: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const nbImages = (pdf: Buffer) => [...pdf.toString("latin1").matchAll(/\/Subtype\s*\/Image\b/g)].length;

// L'attestation se rend depuis son INSTANTANÉ (lot 4, 2026-09-28), plus depuis la fiche et le contrat.
const donnees: DonneesAttestation = {
  type: "TRAVAIL", nom: "Aimée Mutita", sexe: "F", matricule: "PEF-007", poste: "Cuisinière",
  typeContrat: "CDI — durée indéterminée", dateEmbauche: "2025-01-06", enPoste: true, dateSortie: null,
};

describe("signature de la Direction : hors de public/, lue côté serveur", () => {
  it("aucun fichier de public/ n'est une signature", () => {
    const suspects = fichiers(path.join(RACINE, "public"))
      .map((f) => path.relative(RACINE, f))
      .filter((f) => /signature/i.test(f));
    expect(suspects).toEqual([]);
  });

  it("le chemin des PDF est hors de public/ et le fichier existe", () => {
    const rel = path.relative(RACINE, SIGNATURE_DIRECTRICE_PATH);
    expect(rel.split(path.sep)[0]).not.toBe("public");
    expect(rel).toBe(path.join("assets", "signatures", "signature-directrice.png"));
    expect(signatureDirectriceDisponible()).toBe(true);
  });

  it("sans signature téléversée dans les Paramètres, les documents prennent CE fichier", async () => {
    const { signature } = await chargerEntreprise();
    expect(signature).toBe(SIGNATURE_DIRECTRICE_PATH);
  });

  it("une attestation rendue embarque la signature (image aux dimensions du PNG)", async () => {
    const png = fs.readFileSync(SIGNATURE_DIRECTRICE_PATH);
    const { l, h } = dimensionsPng(png);

    const base = { donnees, numero: "ATT-2026-0001", delivreeLe: new Date("2026-09-28T10:00:00Z") };
    const signee = await renderPdfBuffer(AttestationDocument({ ...base }));
    const sansSignature = await renderPdfBuffer(AttestationDocument({ ...base, signature: null }));

    // Un PNG à couche alpha s'écrit en DEUX objets image (l'image + son masque /SMask).
    expect(nbImages(signee)).toBeGreaterThan(nbImages(sansSignature));
    const dims = new RegExp(`/Width\\s+${l}\\b[\\s\\S]{0,400}?/Height\\s+${h}\\b|/Height\\s+${h}\\b[\\s\\S]{0,400}?/Width\\s+${l}\\b`);
    expect(signee.toString("latin1")).toMatch(dims);
    expect(sansSignature.toString("latin1")).not.toMatch(dims);
  }, 60_000);
});
