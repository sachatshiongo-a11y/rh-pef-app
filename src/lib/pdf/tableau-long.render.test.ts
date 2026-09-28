import { describe, it, expect } from "vitest";
import React from "react";
import { Document, Page } from "@react-pdf/renderer";
import { renderPdfBuffer } from "./fonts";
import { TablesDocument } from "./tableau";
import { TableauMouvements } from "./rapport-exploitation";
import { celluleRapportPdf, libellePeriodeRapport, versTableSpec } from "@/lib/rapports-pdf";
import { ecartMinimalEntreRangees, pagesDuPdf, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";

/**
 * Tableaux PDF plus hauts qu'une page — défaut constaté par la Direction le 2026-09-28 sur le
 * « Rapport — Achats de légumes frais — détail » : rangées écrites les unes PAR-DESSUS les autres,
 * barre d'en-tête sans libellés, titres de section recouverts, période « 01 septembre 2025 '19
 * septembre 2026 », montants bruts (« 100000 », « 1505.39 »).
 *
 * Cause : le tableau entier était un bloc insécable (`wrap={false}`) ; plus haut que la page,
 * react-pdf l'ÉCRASE pour le faire tenir sur une seule. Même défaut dans les tableaux Recettes /
 * Dépenses du rapport Exploitation. Les tests RENDENT le PDF et mesurent la position des rangées.
 */

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const FONTE = 8; // taille du texte des rangées : deux rangées lisibles sont au moins aussi espacées

function rapportLegumes(nbJours: number) {
  const noms = ["Ail", "Carottes", "Oignons", "Poivrons", "Tomates fraiches", "Persil", "Laitue", "Courgette"];
  const synthese = noms.map((n, i) => [n, "Kg", 12.5 + i, 1.23 + i, 100000 + i * 5000, 1505.39 * (i + 1)]);
  const detail = Array.from({ length: nbJours }, (_, d) => [`${String((d % 28) + 1).padStart(2, "0")}/09/2026`, noms[d % noms.length], "Kg", 2.5, 1.2, 7526.950000000001, 1505.39]);
  return { synthese, detail };
}

async function renduLegumes(nbJours: number) {
  const { synthese, detail } = rapportLegumes(nbJours);
  const periode = libellePeriodeRapport(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-28T00:00:00Z"));
  return renderPdfBuffer(
    TablesDocument({
      titre: "Rapport — Achats de légumes frais — détail",
      sousTitre: periode,
      tables: [
        versTableSpec({ entete: ["Légume", "Unité", "Quantité", "Prix U. USD", "Prix total USD", "Total CDF"], lignes: synthese, largeurs: ["30%", "12%", "14%", "15%", "15%", "14%"], droite: [2, 3, 4, 5], sommables: [4, 5] }, "Synthèse par article"),
        versTableSpec({ entete: ["Date", "Légume", "Unité", "Quantité", "Prix U. USD", "Total USD", "Total CDF"], lignes: detail, largeurs: ["12%", "26%", "11%", "13%", "13%", "13%", "12%"], droite: [3, 4, 5, 6], sommables: [5, 6] }, "Achats jour par jour"),
      ],
    }),
  );
}

describe("rapport « Achats de légumes frais — détail » (plusieurs tableaux)", () => {
  it("un détail de 90 jours se découpe sur plusieurs pages, rangées JAMAIS superposées", async () => {
    const pdf = await renduLegumes(90);
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const textes = await textesPoses(pdf);
    // Toutes les rangées sont là…
    expect(textes.filter((t) => DATE.test(t.texte))).toHaveLength(90);
    // …et chacune à sa place : l'écart entre deux rangées vaut au moins la hauteur du texte.
    expect(ecartMinimalEntreRangees(textes, DATE)).toBeGreaterThanOrEqual(FONTE);
    // La barre d'en-tête (libellés lisibles) se répète sur chaque page qui porte des rangées.
    for (const p of new Set(textes.filter((t) => DATE.test(t.texte)).map((t) => t.page))) {
      const surPage = textes.filter((t) => t.page === p).map((t) => t.texte);
      expect(surPage, `page ${p}`).toContain("PRIX U. USD");
    }
    // Titre de section au-dessus de sa barre d'en-tête, jamais recouvert.
    const titre = textes.find((t) => t.texte === "ACHATS JOUR PAR JOUR")!;
    const entete = textes.find((t) => t.page === titre.page && t.texte === "DATE")!;
    expect(entete.y - titre.y).toBeGreaterThanOrEqual(FONTE);
  }, 60_000);

  it("période « du … au … », montants au format maison, aucune police de repli", async () => {
    const pdf = await renduLegumes(10);
    const plat = (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
    expect(plat).toContain("du 01 septembre 2026 au 28 septembre 2026");
    expect(plat).toContain("100 000,00"); // prix total USD
    expect(plat).toContain("7 526,95");
    expect(plat).toContain("1 505"); // total CDF, sans décimale
    expect(plat).not.toMatch(/1505\.39|7526\.95|100000\b/);
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});

describe("rapport Exploitation — tableau des écritures", () => {
  it("90 écritures : plusieurs pages, rangées jamais superposées", async () => {
    const lignes = Array.from({ length: 90 }, (_, i) => ({ rubrique: "Achats", categorie: "Matières", denomination: `Écriture ${i + 1}`, compte: "Caisse", montantUSD: 10 + i, fournisseur: null, fournisseurStockId: null }));
    const doc = React.createElement(Document, null, React.createElement(Page, { size: "A4", style: { padding: 30, fontFamily: "Optima", fontSize: 8.5 } },
      React.createElement(TableauMouvements, { titre: "Dépenses", couleur: "#b42318", lignes, totalLabel: "Total dépenses", totalMontant: 1234, messageVide: "Aucune" })));
    const pdf = await renderPdfBuffer(doc as Parameters<typeof renderPdfBuffer>[0]);
    const textes = await textesPoses(pdf);
    expect(new Set(textes.map((t) => t.page)).size).toBeGreaterThanOrEqual(2);
    expect(textes.filter((t) => /^Écriture \d+$/.test(t.texte))).toHaveLength(90);
    expect(ecartMinimalEntreRangees(textes, /^Écriture \d+$/)).toBeGreaterThanOrEqual(FONTE);
  }, 60_000);
});

describe("cellules des rapports dans le PDF", () => {
  it("montants selon l'en-tête, quantités, variations sans flèche", () => {
    expect(celluleRapportPdf("Montant USD", 1049.756)).toBe("1 049,76");
    expect(celluleRapportPdf("Total CDF", 1234567.5)).toBe("1 234 568");
    expect(celluleRapportPdf("Quantité", 2.5)).toBe("2,5");
    expect(celluleRapportPdf("Variation USD", "↑ 12 %")).toBe("+12 %");
    expect(celluleRapportPdf("Variation", "↓ 5 %")).toBe("−5 %");
    expect(celluleRapportPdf("Statut", "Payée")).toBe("Payée");
  });
});
