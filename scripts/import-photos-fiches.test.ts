import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import sharp from "sharp";
import {
  parseRelationships,
  resoudreCheminRelatif,
  extraireImagesParOnglet,
  calculerRattachements,
  compresserImage,
  formaterRapport,
  importeeParCeScript,
  type FicheBase,
  type ImageEmbarquee,
} from "./import-photos-fiches";
import { normaliserDesignation, type FicheParsee } from "./import-fiches-plats";

// PNG 1×1 minimal, valide (mêmes octets que dans photo-actions.integration.test.ts).
const OCTETS_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a4944415478da6300010000050001a5f645400000000049454e44ae426082",
  "hex",
);

// ─── Bas niveau : relations OOXML ────────────────────────────────────────────────────────────────

describe("parseRelationships / résolution de chemin", () => {
  it("extrait Id/Type/Target d'un fragment de .rels réel", () => {
    const xml =
      '<?xml version="1.0"?><Relationships xmlns="…">' +
      '<Relationship Id="rId1" Type=".../relationships/drawing" Target="../drawings/drawing3.xml"/>' +
      '<Relationship Id="rId2" Type=".../relationships/comments" Target="../comments1.xml"/>' +
      "</Relationships>";
    const rels = parseRelationships(xml);
    expect(rels).toHaveLength(2);
    expect(rels[0]).toEqual({ id: "rId1", type: ".../relationships/drawing", target: "../drawings/drawing3.xml" });
  });

  it("ignore les relations externes (TargetMode=\"External\") — jamais un lien web pris pour un média", () => {
    const xml = '<Relationship Id="rId9" Type=".../hyperlink" Target="https://exemple.test" TargetMode="External"/>';
    expect(parseRelationships(xml)).toHaveLength(0);
  });

  it("résout les chemins relatifs comme un onglet, un dessin et un média réels", () => {
    expect(resoudreCheminRelatif("xl", "worksheets/sheet3.xml")).toBe("xl/worksheets/sheet3.xml");
    expect(resoudreCheminRelatif("xl/worksheets", "../drawings/drawing3.xml")).toBe("xl/drawings/drawing3.xml");
    expect(resoudreCheminRelatif("xl/drawings", "../media/image7.jpg")).toBe("xl/media/image7.jpg");
  });
});

// ─── Extraction de bout en bout sur un vrai .xlsx (généré par exceljs, structure OOXML réelle) ───

async function construireClasseurDeTest(): Promise<{ chemin: string; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "pef-photos-test-"));
  const chemin = path.join(dir, "classeur-test.xlsx");
  const wb = new ExcelJS.Workbook();

  const avecPhoto = wb.addWorksheet("Bolognaise 4.6 kg");
  avecPhoto.getCell("B13").value = "Bolognaise maison";
  const sansPhoto = wb.addWorksheet("Sans photo");
  sansPhoto.getCell("B13").value = "Sans photo";
  const avecLogoPartage = wb.addWorksheet("Carbonara");
  avecLogoPartage.getCell("B13").value = "Carbonara";
  const avecLogoPartage2 = wb.addWorksheet("Tiramisu");
  avecLogoPartage2.getCell("B13").value = "Tiramisu";

  // `base64`, pas `buffer` : même convention que src/lib/export-excel.ts (le typage exceljs de
  // l'option `buffer` n'accepte pas le `Buffer<ArrayBuffer>` renvoyé par `Buffer.from(hex, "hex")`).
  const base64Png = OCTETS_PNG.toString("base64");
  const idPhotoUnique = wb.addImage({ base64: base64Png, extension: "png" });
  avecPhoto.addImage(idPhotoUnique, "B2:D6");

  // Une image "logo" partagée par DEUX onglets — cf. le classeur réel où image1.png est réutilisée.
  const idLogo = wb.addImage({ base64: base64Png, extension: "png" });
  avecLogoPartage.addImage(idLogo, "A1:A1");
  avecLogoPartage2.addImage(idLogo, "A1:A1");

  await wb.xlsx.writeFile(chemin);
  return { chemin, dir };
}

describe("extraireImagesParOnglet — chaîne complète sur un vrai .xlsx", () => {
  it("retrouve une entrée pour chaque onglet, l'image unique sur le bon onglet, et rien sur les autres", async () => {
    const { chemin, dir } = await construireClasseurDeTest();
    try {
      const zip = await JSZip.loadAsync(readFileSync(chemin));
      const images = await extraireImagesParOnglet(zip);

      expect([...images.keys()].sort()).toEqual(["Bolognaise 4.6 kg", "Carbonara", "Sans photo", "Tiramisu"].sort());
      expect(images.get("Bolognaise 4.6 kg")).toHaveLength(1);
      expect(images.get("Sans photo")).toHaveLength(0);
      expect(images.get("Carbonara")).toHaveLength(1);
      expect(images.get("Tiramisu")).toHaveLength(1);

      // Le logo partagé : même chemin média sur les deux onglets qui le portent.
      expect(images.get("Carbonara")![0]!.mediaPath).toBe(images.get("Tiramisu")![0]!.mediaPath);
      // L'image "unique" est un fichier PHYSIQUEMENT différent du logo partagé.
      expect(images.get("Bolognaise 4.6 kg")![0]!.mediaPath).not.toBe(images.get("Carbonara")![0]!.mediaPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

// ─── Rattachement (pur) ─────────────────────────────────────────────────────────────────────────

const img = (mediaPath: string, octets = 1000): ImageEmbarquee => ({ mediaPath, extension: "jpg", octets: Buffer.alloc(octets) });
const ficheParsee = (onglet: string, nom: string): FicheParsee => ({
  onglet,
  nom,
  nomBrut: nom,
  cles: [...new Set([normaliserDesignation(onglet), normaliserDesignation(nom)])],
  textesEntete: [nom],
  categorie: null,
  nbPortions: 1,
  prixVenteTTC: null,
  tauxTVA: null,
  coefficientMargeCible: null,
  recette: null,
  rendementQuantiteG: null,
  rendementUniteSource: null,
  estSousRecette: false,
  ingredients: [],
});
const ficheBase = (id: string, nom: string, photoUrl: string | null = null): FicheBase => ({ id, nom, photoUrl });

describe("calculerRattachements", () => {
  it("rattache une image unique à sa fiche, via le nom de la fiche (B13), différent du nom d'onglet", () => {
    const images = new Map([["Bolognaise 4.6 kg", [img("xl/media/image2.jpg")]]]);
    const classeur = [ficheParsee("Bolognaise 4.6 kg", "Bolognaise maison")];
    const base = [ficheBase("f1", "Bolognaise maison")];

    const r = calculerRattachements(images, classeur, base);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ statut: "RATTACHEE", fiche: { id: "f1" } });
  });

  it("ne rattache JAMAIS une image partagée par plusieurs onglets (signalée comme un logo)", () => {
    const media = "xl/media/image1.png";
    const images = new Map([
      ["Carbonara", [img(media)]],
      ["Tiramisu", [img(media)]],
    ]);
    const classeur = [ficheParsee("Carbonara", "Carbonara"), ficheParsee("Tiramisu", "Tiramisu")];
    const base = [ficheBase("f1", "Carbonara"), ficheBase("f2", "Tiramisu")];

    const r = calculerRattachements(images, classeur, base);
    expect(r).toHaveLength(2);
    for (const x of r) {
      expect(x.statut).toBe("NON_RATTACHEE");
      expect((x as { raison: string }).raison).toContain("partagée");
    }
  });

  it("signale une image dont l'onglet ne correspond à aucune fiche en base", () => {
    const images = new Map([["Plat oublié", [img("xl/media/image9.jpg")]]]);
    const classeur = [ficheParsee("Plat oublié", "Plat oublié")];
    const r = calculerRattachements(images, classeur, []);
    expect(r[0]).toMatchObject({ statut: "NON_RATTACHEE" });
    expect((r[0] as { raison: string }).raison).toContain("aucune fiche en base");
  });

  it("refuse un rattachement quand deux fiches en base sont homonymes (même nom normalisé)", () => {
    const images = new Map([["Salade", [img("xl/media/image9.jpg")]]]);
    const classeur = [ficheParsee("Salade", "Salade César")];
    const base = [ficheBase("f1", "Salade César"), ficheBase("f2", "Salade Cesar")]; // diacritique seul diffère
    const r = calculerRattachements(images, classeur, base);
    expect(r[0]).toMatchObject({ statut: "NON_RATTACHEE" });
    expect((r[0] as { raison: string }).raison).toContain("homonyme");
  });

  it("refuse la concurrence : deux onglets (deux images uniques différentes) visent la même fiche", () => {
    const images = new Map([
      ["Onglet A", [img("xl/media/image2.jpg")]],
      ["Onglet B tronqué", [img("xl/media/image3.jpg")]],
    ]);
    // Les deux onglets se résolvent, par leurs clés, vers LA MÊME fiche de base « Doublon ».
    const classeur = [
      { ...ficheParsee("Onglet A", "Doublon"), cles: ["onglet a", "doublon"] },
      { ...ficheParsee("Onglet B tronqué", "Doublon"), cles: ["onglet b tronque", "doublon"] },
    ];
    const base = [ficheBase("f1", "Doublon")];
    const r = calculerRattachements(images, classeur, base);
    expect(r.every((x) => x.statut === "NON_RATTACHEE")).toBe(true);
    for (const x of r) expect((x as { raison: string }).raison).toContain("concurrence");
  });

  it("rapproche l'onglet tronqué par Excel du nom réellement retenu (B13) — pas de correspondance sur le nom d'onglet seul", () => {
    // Nom d'onglet tronqué (31 caractères max Excel) ; le nom RETENU (B13, nettoyé) est plus long / différent.
    const images = new Map([["Sauté de blanc de poulet a", [img("xl/media/image4.jpg")]]]);
    const classeur = [ficheParsee("Sauté de blanc de poulet a", "Sauté de blanc de poulet aux champignons")];
    const base = [ficheBase("f1", "Sauté de blanc de poulet aux champignons")];
    const r = calculerRattachements(images, classeur, base);
    expect(r[0]).toMatchObject({ statut: "RATTACHEE", fiche: { id: "f1" } });
  });
});

// ─── Compression ────────────────────────────────────────────────────────────────────────────────

describe("compresserImage", () => {
  it("redimensionne une image large à 1000 px et réencode en JPEG, poids réduit", async () => {
    const grande = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 120, g: 80, b: 40 } } })
      .jpeg({ quality: 100 })
      .toBuffer();

    const c = await compresserImage(grande);
    expect(c.largeur).toBe(1000);
    expect(c.hauteur).toBe(750);
    expect(c.octetsApres).toBeLessThan(grande.length);
    expect((await sharp(c.bytes).metadata()).format).toBe("jpeg");
  }, 20_000);

  it("n'agrandit jamais une image déjà plus petite que la largeur cible", async () => {
    const petite = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 10, b: 10 } } })
      .png()
      .toBuffer();
    const c = await compresserImage(petite);
    expect(c.largeur).toBe(200);
    expect(c.hauteur).toBe(100);
  }, 20_000);
});

// ─── Idempotence et rapport ─────────────────────────────────────────────────────────────────────

describe("importeeParCeScript", () => {
  it("reconnaît une photo déjà écrite par ce script (préfixe fiches-techniques/)", () => {
    expect(importeeParCeScript("/fichiers/fiches-techniques/abc-123.jpg")).toBe(true);
  });
  it("ne confond pas une photo ajoutée manuellement (autre préfixe) avec un import déjà fait", () => {
    expect(importeeParCeScript("/fichiers/autre-prefixe/x.jpg")).toBe(false);
    expect(importeeParCeScript(null)).toBe(false);
  });
});

describe("formaterRapport", () => {
  it("liste rattachées, non rattachées, et fiches sans aucune photo ni candidate", () => {
    const rattachements = calculerRattachements(
      new Map([["Bolognaise", [img("xl/media/image2.jpg")]]]),
      [ficheParsee("Bolognaise", "Bolognaise")],
      [ficheBase("f1", "Bolognaise"), ficheBase("f2", "Sans aucune photo")],
    );
    const rapport = formaterRapport(rattachements, new Map(), [ficheBase("f1", "Bolognaise"), ficheBase("f2", "Sans aucune photo")], "DRY_RUN");
    expect(rapport).toContain("Bolognaise");
    expect(rapport).toContain("Sans aucune photo");
    expect(rapport).toContain("MARCHE À VIDE");
  });
});
