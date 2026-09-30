import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { ComparaisonDocument, TAILLES_COMPARAISON } from "@/lib/pdf/comparaison";
import { lignesExportComparaison, partiesPdfComparaison, type LigneComparaison } from "./journalier-restaurant";
import { PIED_PDF_COMPARAISON, partiesDocumentComparaison } from "./journalier-comparaison-export";
import { LABELS_FIXTURE, lignesFixture } from "@/app/(stock)/stock/journalier/comparaison.fixture";

// PDF de l'onglet Comparaison (commandé / livré / consommé × 7 jours + totaux = 25 colonnes). Rendu
// constaté le 2026-09-28 : sur une seule page paysage, « 1 180,125 » se coupait sur deux lignes. Il
// est donc rendu en DEUX parties paysage (lun -> jeu, puis ven -> dim et totaux), 13 colonnes chacune.
// Refonte de lisibilité du 2026-09-30 : deux niveaux d'en-tête sans capitales, jours séparés, écarts
// signés sous la valeur, jamais moins de 8 pt, jamais de rangées écrasées.
// `PDF_SORTIE=chemin` écrit le PDF pour le regarder.

const LABELS = LABELS_FIXTURE;
const ligne = (i: number): LigneComparaison => ({
  id: `a${i}`, designation: i === 0 ? "Parmigiano Reggiano 24 mois" : `Article ${i}`, categorie: i < 6 ? "Épicerie" : "Boissons", lien: true,
  cmd: [12.5, 0, 3, 1250, 0, 2, 1], liv: [12.5, 1, 0, 1250, 0, 2, 0.25],
  conso: ["10.75", null, "2.5", "1180.125", null, "1.5", "0.2"],
  ecarts: ["LIVRE_NON_CONSOMME", null, "CONSOMME_PLUS_QUE_LIVRE", "LIVRE_NON_CONSOMME", null, "LIVRE_NON_CONSOMME", null],
});

async function rendre(lignes: LigneComparaison[]) {
  const d = lignesExportComparaison(lignes, LABELS);
  const parties = partiesPdfComparaison(LABELS);
  const buffer = await renderPdfBuffer(ComparaisonDocument({
    titre: "Comparaison commandé / livré / consommé", sousTitre: "Semaine du 21/9 au 27/9",
    parties: partiesDocumentComparaison(d, parties), pied: PIED_PDF_COMPARAISON,
  }));
  if (process.env.PDF_SORTIE) writeFileSync(process.env.PDF_SORTIE, buffer);
  return { d, parties, buffer };
}

type Item = { str: string; x: number; y: number; taille: number };
async function pages(buffer: Buffer): Promise<{ items: Item[]; hauteur: number }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false }).promise;
  const res: { items: Item[]; hauteur: number }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const contenu = await page.getTextContent();
    res.push({
      hauteur: page.view[3]!,
      items: contenu.items.flatMap((i) => ("str" in i && i.str.trim() ? [{ str: i.str.trim(), x: i.transform[4] as number, y: i.transform[5] as number, taille: Math.abs(i.transform[3] as number) }] : [])),
    });
  }
  await doc.destroy();
  return res;
}

describe("PDF de la comparaison commandé / livré / consommé", () => {
  it("deux parties paysage de 13 colonnes : chaque valeur tient sur une ligne, l'écart est signé", async () => {
    const { d, parties, buffer } = await rendre(Array.from({ length: 12 }, (_, i) => ligne(i)));
    expect(d.colonnes).toHaveLength(25);
    expect(parties.map((p) => p.titre)).toEqual(["Lun 21 à Jeu 24", "Ven 25 à Dim 27, et totaux de la semaine"]);
    expect(parties.map((p) => p.indices.length)).toEqual([13, 13]);
    // Toutes les colonnes de l'export sont reprises, une seule fois (hors « Article »).
    expect(parties.flatMap((p) => p.indices.slice(1)).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    for (const p of parties) {
      expect(p.colonnes.map((c) => c.header).slice(1)).toEqual(p.indices.slice(1).map((i) => d.colonnes[i]!.header));
      expect(p.colonnes.reduce((t, c) => t + Number(String(c.width).replace("%", "")), 0)).toBeLessThanOrEqual(100.0001);
      expect(p.groupes.reduce((t, g) => t + g.nb, 0)).toBe(p.colonnes.length - 1);
    }
    const texte = (await pages(buffer)).flatMap((p) => p.items.map((i) => i.str)).join(" ");
    // Une valeur coupée sur deux lignes ne se lirait plus d'un seul tenant.
    expect(texte).toContain("1 180,125");
    expect(texte).toContain("1 268,5");
    expect(texte).toContain("Parmigiano Reggiano 24 mois");
    expect(texte).toContain("Lun 21 à Jeu 24");
    // En-têtes à deux niveaux, en toutes lettres courtes : jamais « CMD », « LUN 21 ».
    for (const attendu of ["Lun 21", "Ven 25", "Total", "Cmd", "Livré", "Conso"]) expect(texte).toContain(attendu);
    expect(texte).not.toMatch(/CMD|LIVRÉ|CONSO|LUN 21|TOT\./);
    // Écarts signés : consommé 10,75 pour 12,5 livrés = -1,75 ; consommé 2,5 pour 0 livré = +2,5.
    expect(texte).toContain("-1,75");
    expect(texte).toContain("+2,5");
  }, 60_000);

  it("aucune écriture sous 8 pt, aucune rangée écrasée, l'en-tête se répète à chaque page", async () => {
    const lignes = lignesFixture(60);
    const { buffer } = await rendre(lignes);
    const ps = await pages(buffer);
    expect(ps.length).toBeGreaterThan(2); // le tableau se découpe entre les pages
    const noms = new Set(lignes.map((l) => l.designation));
    let vus = 0;
    for (const [n, p] of ps.entries()) {
      // Hors zone du pied de page (coordonnées et numéro), tout ce qui est écrit fait 8 pt au moins.
      for (const i of p.items.filter((x) => x.y > 90)) expect(i.taille, `page ${n + 1} : « ${i.str} »`).toBeGreaterThanOrEqual(8);
      // Les rangées d'articles ne se superposent pas : deux articles n'ont jamais la même hauteur, ni moins d'un corps d'écart.
      // Un nom long passe sur deux lignes dans sa case : on compte sa première ligne.
      const ys = p.items.filter((i) => i.x < 120 && [...noms].some((n) => n === i.str || n.startsWith(`${i.str} `))).map((i) => i.y).sort((a, b) => b - a);
      vus += ys.length;
      ys.slice(1).forEach((y, k) => expect(ys[k]! - y, `page ${n + 1}`).toBeGreaterThanOrEqual(8));
      // Rien ne déborde sur le pied de page.
      ys.forEach((y) => expect(y).toBeGreaterThan(90));
      // La ligne d'en-tête « Cmd / Livré / Conso » est répétée en haut de chaque page du tableau.
      expect(p.items.filter((i) => i.str === "Cmd").length, `page ${n + 1}`).toBeGreaterThanOrEqual(3);
    }
    expect(vus).toBe(lignes.length * 2); // chaque article figure dans les deux parties
  }, 60_000);

  it("aucun caractère absent d'Optima (U+202F, ⚠, flèche, signe moins) ; toutes les tailles déclarées font 8 pt au moins", async () => {
    const { d, parties, buffer } = await rendre(lignesFixture(20));
    const textes = [
      ...d.lignes.flat(), ...parties.flatMap((p) => [p.titre, ...p.colonnes.map((c) => c.header), ...p.groupes.map((g) => g.libelle)]), PIED_PDF_COMPARAISON,
      ...[...d.signes.values()].map((s) => s.signe), ...(await pages(buffer)).flatMap((p) => p.items.map((i) => i.str)),
    ].join("");
    expect(textes).not.toMatch(/[ −→⚠]/);
    for (const [nom, taille] of Object.entries(TAILLES_COMPARAISON)) expect(taille, nom).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
