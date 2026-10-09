import { describe, it, expect } from "vitest";
import { renderPdfBuffer } from "./fonts";
import { ecartMinimalEntreRangees, pagesDuPdf, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";
import { COLONNES_FICHE_COMPTAGE, FicheComptageDocument, rangeesFicheComptage } from "./fiche-comptage";
import { ENTETE_FICHE, lignesFicheComptage } from "@/app/(stock)/stock/reconciliation/fiche/comptage-data";

/** Fiche de comptage VIERGE en PDF : le même contenu que l'Excel, lisible une fois rendu. */

type A = { domaine: string; designation: string; unite: string | null; categorie: { nom: string } | null; fournisseur: { nom: string } | null; stock: { quantite: unknown } | null };
const art = (categorie: string | null, designation: string, quantite: number | null = 12, domaine = "NOURRITURE"): A => ({
  domaine, designation, unite: "Kg", categorie: categorie ? { nom: categorie } : null, fournisseur: { nom: "Fournisseur Élan" }, stock: quantite === null ? null : { quantite },
});

describe("rangées de la fiche PDF", () => {
  it("les mêmes lignes que l'Excel : une rubrique par catégorie, Théorique formaté, Physique et Écart vides", () => {
    const { lignes, sectionRows } = lignesFicheComptage([art("Crèmerie", "Beurre", 1250.5), art("Crèmerie", "Œufs", 0), art(null, "Sel fin", null)], true);
    expect(rangeesFicheComptage(lignes, sectionRows)).toEqual([
      { rubrique: "Crèmerie" },
      { cellules: ["Beurre", "Fournisseur Élan", "Kg", "1 250,5", "", ""] },
      { cellules: ["Œufs", "Fournisseur Élan", "Kg", "0", "", ""] },
      { rubrique: "Sans catégorie" },
      { cellules: ["Sel fin", "Fournisseur Élan", "Kg", "0", "", ""] },
    ]);
    expect(COLONNES_FICHE_COMPTAGE.map((c) => c.entete)).toEqual(ENTETE_FICHE);
    expect(rangeesFicheComptage(lignes, sectionRows).flatMap((r) => ("cellules" in r ? [r.cellules.length] : []))).toEqual([6, 6, 6]);
  });

  it("toutes les largeurs de colonnes font 100 %", () => {
    expect(COLONNES_FICHE_COMPTAGE.reduce((t, c) => t + parseFloat(c.largeur), 0)).toBe(100);
  });
});

function fiche220() {
  const cats = ["À emporter", "Viandes", "Légumes", "Épicerie", "Crèmerie"];
  const articles = Array.from({ length: 220 }, (_, i) => art(cats[Math.floor(i / 44)], `Article ${String(i + 1).padStart(3, "0")}`, i === 7 ? 1250.5 : (i * 7) % 40));
  articles[0] = art("À emporter", "Œufs d'été (boîte) Elle & Vire", 3);
  const { lignes, sectionRows } = lignesFicheComptage(articles, true);
  return FicheComptageDocument({ titre: "Fiche de comptage — Nourriture", sousTitre: "09/10/2026", rangees: rangeesFicheComptage(lignes, sectionRows) });
}

describe("fiche de comptage PDF rendue (220 articles)", () => {
  it("A4, plusieurs pages, aucune police de repli, logo, titre, accents et esperluette", async () => {
    const pdf = await renderPdfBuffer(fiche220());
    expect(policesDeRepli(pdf)).toEqual([]);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595\.\d+\s+841\.\d+\s*\]/);
    expect(pdf.toString("latin1")).toContain("/Subtype /Image"); // le logo
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBeGreaterThan(3);
    const tout = pages.map((p) => p.plat).join(" ");
    for (const t of ["Fiche de comptage — Nourriture", "Œufs d'été (boîte) Elle & Vire", "À emporter", "Article 220", "1 250,5"]) expect(tout).toContain(t);
  }, 120_000);

  it("l'en-tête du tableau se répète sur chaque page", async () => {
    const pages = await pagesDuPdf(await renderPdfBuffer(fiche220()));
    for (const p of pages) for (const t of ENTETE_FICHE) expect(p.plat.toLowerCase()).toContain(t.toLowerCase());
  }, 120_000);

  it("rangées insécables et lisibles : aucune rangée écrasée sur une autre, aucun titre de rubrique seul en bas de page", async () => {
    const pdf = await renderPdfBuffer(fiche220());
    const textes = await textesPoses(pdf);
    expect(ecartMinimalEntreRangees(textes, /^Article \d{3}$/)).toBeGreaterThanOrEqual(12);
    const pages = await pagesDuPdf(pdf);
    for (const p of pages) {
      const dernier = p.lignes.filter((l) => /^(Article \d{3}|À emporter|Viandes|Légumes|Épicerie|Crèmerie)\b/.test(l)).at(-1) ?? "";
      expect(dernier).toMatch(/^Article/);
    }
  }, 120_000);

  it("les cases Physique et Écart restent vides : aucun chiffre ne tombe sous leurs colonnes", async () => {
    const textes = await textesPoses(await renderPdfBuffer(fiche220()));
    const entete = textes.find((t) => t.texte.toLowerCase() === "physique")!;
    const gauche = entete.x - 5;
    const sous = textes.filter((t) => t.page === entete.page && t.y > entete.y + 5 && t.y < 750 && t.x >= gauche);
    expect(sous).toEqual([]);
  }, 120_000);
});
