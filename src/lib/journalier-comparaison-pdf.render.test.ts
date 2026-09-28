import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { TableauxParPartieDocument } from "@/lib/pdf/tableau";
import { lignesExportComparaison, partiesPdfComparaison, type LigneComparaison } from "./journalier-restaurant";

// PDF de l'onglet Comparaison (commandé / livré / consommé × 7 jours + totaux = 25 colonnes). Rendu
// constaté le 2026-09-28 : sur une seule page paysage, « 1 180,125 » se coupait sur deux lignes. Il
// est donc rendu en DEUX parties paysage (lun → jeu, puis ven → dim et totaux), 13 colonnes chacune.
// `PDF_SORTIE=chemin` écrit le PDF pour le regarder.

async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n");
}

const LABELS = ["Lun 21", "Mar 22", "Mer 23", "Jeu 24", "Ven 25", "Sam 26", "Dim 27"];
const ligne = (i: number): LigneComparaison => ({
  id: `a${i}`, designation: i === 0 ? "Parmigiano Reggiano 24 mois" : `Article ${i}`, categorie: i < 6 ? "Épicerie" : "Boissons", lien: true,
  cmd: [12.5, 0, 3, 1250, 0, 2, 1], liv: [12.5, 1, 0, 1250, 0, 2, 0.25],
  conso: ["10.75", null, "2.5", "1180.125", null, "1.5", "0.2"],
  ecarts: ["LIVRE_NON_CONSOMME", null, "CONSOMME_PLUS_QUE_LIVRE", "LIVRE_NON_CONSOMME", null, "LIVRE_NON_CONSOMME", null],
});

describe("PDF de la comparaison commandé / livré / consommé", () => {
  it("deux parties paysage de 13 colonnes : chaque valeur tient sur une ligne", async () => {
    const d = lignesExportComparaison(Array.from({ length: 12 }, (_, i) => ligne(i)), LABELS);
    expect(d.colonnes).toHaveLength(25);
    const parties = partiesPdfComparaison(LABELS);
    expect(parties.map((p) => p.titre)).toEqual(["Lun 21 à Jeu 24", "Ven 25 à Dim 27, et totaux de la semaine"]);
    expect(parties.map((p) => p.indices.length)).toEqual([13, 13]);
    // Toutes les colonnes de l'export sont reprises, une seule fois (hors « Article »).
    expect(parties.flatMap((p) => p.indices.slice(1)).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    for (const p of parties) {
      expect(p.colonnes.map((c) => c.header).slice(1)).toEqual(p.indices.slice(1).map((i) => d.colonnes[i]!.header));
      expect(p.colonnes.reduce((t, c) => t + Number(String(c.width).replace("%", "")), 0)).toBeLessThanOrEqual(100.0001);
    }
    const buffer = await renderPdfBuffer(TableauxParPartieDocument({
      titre: "Comparaison commandé / livré / consommé", sousTitre: "Semaine du 21/9 au 27/9", paysage: true,
      parties: parties.map((p) => ({ titre: p.titre, colonnes: p.colonnes, lignes: d.lignes.map((l) => p.indices.map((i) => l[i] ?? "")), sectionRows: d.sectionRows })),
      pied: "Vert = commande · rouge = livraison · indigo = consommé.",
    }));
    if (process.env.PDF_SORTIE) writeFileSync(process.env.PDF_SORTIE, buffer);
    const texte = await texteDu(buffer);
    // Une valeur coupée sur deux lignes ne se lirait plus d'un seul tenant dans le texte extrait.
    expect(texte).toContain("1 180,125");
    expect(texte).toContain("1 268,5");
    expect(texte).toContain("Parmigiano Reggiano 24 mois");
    expect(texte).toContain("Lun 21 à Jeu 24");
  }, 60_000);
});
