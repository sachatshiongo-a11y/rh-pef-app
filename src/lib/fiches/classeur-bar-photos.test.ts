import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { lireClasseurBar, lirePhotosClasseur } from "./classeur-bar";

// Photos des feuilles du classeur du bar : jamais le logo partagé, une photo partagée entre deux
// feuilles annoncée (et décochée d'office par l'écran), plusieurs images = aucune choisie.

const ORIGINAL = `${process.env.HOME}/Downloads/Tableurs/Fiches techniques du bar(Récupération automatique).xlsx`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 4, 5, 6]);

/** Classeur minimal : `feuilles` = nom → images portées (chemins sous xl/media). */
async function classeur(feuilles: Record<string, string[]>): Promise<Uint8Array> {
  const z = new JSZip();
  const noms = Object.keys(feuilles);
  z.file("xl/workbook.xml", `<workbook><sheets>${noms.map((n, k) => `<sheet name="${n}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships>${noms.map((_, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}</Relationships>`);
  const medias = new Set<string>();
  noms.forEach((n, k) => {
    z.file(`xl/worksheets/sheet${k + 1}.xml`, "<worksheet/>");
    if (!feuilles[n]!.length) return;
    z.file(`xl/worksheets/_rels/sheet${k + 1}.xml.rels`, `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${k + 1}.xml"/></Relationships>`);
    z.file(`xl/drawings/drawing${k + 1}.xml`, "<xdr:wsDr/>");
    z.file(`xl/drawings/_rels/drawing${k + 1}.xml.rels`, `<Relationships>${feuilles[n]!.map((m, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m}"/>`).join("")}</Relationships>`);
    for (const m of feuilles[n]!) medias.add(m);
  });
  for (const m of medias) z.file(`xl/media/${m}`, m.endsWith(".png") ? PNG : JPG);
  return z.generateAsync({ type: "uint8array" });
}

describe("photos des feuilles", () => {
  it("logo (plus de deux feuilles) jamais proposé ; photo propre ; photo partagée à deux annoncée ; plusieurs ou format inconnu : écartées", async () => {
    const octets = await classeur({
      "Mojito": ["logo.png", "mojito.jpg"],
      "Virgin Mojito": ["logo.png", "mojito.jpg"],
      "Blue Lady": ["logo.png", "blue.jpeg"],
      "Kir royal ": ["logo.png"],
      "Deux photos": ["a.jpg", "b.jpg"],
      "Tiff": ["c.tiff"],
    });
    const r = await lirePhotosClasseur(octets, ["Mojito", "Virgin Mojito", "Blue Lady", "Kir royal", "Deux photos", "Tiff"]);
    expect([...r.photos.values()].map((p) => [p.feuille, p.chemin, p.type, p.partageeAvec])).toEqual([
      ["Mojito", "xl/media/mojito.jpg", "image/jpeg", ["Virgin Mojito"]],
      ["Virgin Mojito", "xl/media/mojito.jpg", "image/jpeg", ["Mojito"]],
      ["Blue Lady", "xl/media/blue.jpeg", "image/jpeg", []],
    ]);
    expect(r.photos.get("Blue Lady")!.octets).toEqual(JPG);
    expect(r.ecartees).toEqual([
      { feuille: "Deux photos", raison: "2 images sur la feuille : aucune choisie d'office" },
      { feuille: "Tiff", raison: "format « tiff » non pris en charge (PNG, JPG ou WEBP)" },
    ]);
  });

  it("un fichier illisible ne lève pas : aucune photo", async () => {
    expect(await lirePhotosClasseur(new Uint8Array([1, 2, 3]), ["x"])).toEqual({ photos: new Map(), ecartees: [] });
  });

  it("la fixture (sans images) ne propose aucune photo", async () => {
    const b = fs.readFileSync(path.join(__dirname, "__fixtures__", "fiches-bar.xlsx"));
    const r = await lireClasseurBar(b);
    if (!r.ok) throw new Error(r.erreur);
    expect((await lirePhotosClasseur(b, r.fiches.map((f) => f.feuille))).photos.size).toBe(0);
  });

  it.skipIf(!fs.existsSync(ORIGINAL))("le VRAI classeur : 26 photos, le logo jamais, 3 paires cocktail/mocktail partagées", async () => {
    const b = fs.readFileSync(ORIGINAL);
    const r = await lireClasseurBar(b);
    if (!r.ok) throw new Error(r.erreur);
    const p = await lirePhotosClasseur(b, r.fiches.map((f) => f.feuille));
    expect(p.photos.size).toBe(26);
    expect([...p.photos.values()].some((x) => x.chemin === "xl/media/image1.png")).toBe(false); // le logo
    expect([...p.photos.values()].filter((x) => x.partageeAvec.length).map((x) => x.feuille)).toEqual([
      "Pinacolada cocktail", "PinaColada mocktail", "Virgin Mojito", "Mojito", "Pop Cola mocktail", "Pop Cola cocktail",
    ]);
    expect(r.fiches.map((f) => f.feuille).filter((f) => !p.photos.has(f))).toEqual(["Milkshake pomme", "Folie douce", "Kir royal"]);
  }, 60_000);
});
