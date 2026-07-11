import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { classeurInventaire } from "./export-excel";

describe("classeurInventaire — KPIs + inventaire + mouvements dans une même feuille par domaine", () => {
  it("produit une feuille par domaine, avec bloc KPI, colonnes enrichies et mouvements du domaine", async () => {
    const buf = await classeurInventaire({
      periode: "juillet 2026",
      feuilles: [
        {
          nom: "Nourriture",
          titre: "Inventaire Nourriture — juillet 2026",
          kpis: [
            { label: "Valeur du stock — Nourriture", valeur: "2 549,75 $" },
            { label: "En rupture (urgent)", valeur: "12" },
          ],
          invEntete: ["Code", "Désignation", "Unité", "Catégorie", "Fournisseur", "Stock min", "Stock final", "Alerte stock", "Prix U. USD", "Valeur USD"],
          invLignes: [["3", "Carré d'agneau", "Kg", "Viande", "ZURAFA", 5, 4.17, "À réapprovisionner", 48.06, 200.41]],
          invTotauxCols: [9],
          mvtTitre: "MOUVEMENTS DU MOIS — Nourriture",
          mvtEntete: ["Date", "Code", "Désignation", "Entrées", "Sorties", "Valeur USD"],
          mvtLignes: [["06/07/2026", "3", "Carré d'agneau", "", "2", 96.12]],
        },
        { nom: "Boissons", titre: "Inventaire Boissons", kpis: [{ label: "Valeur", valeur: "0 $" }], invEntete: ["Code", "Désignation"], invLignes: [], mvtTitre: "MOUVEMENTS DU MOIS — Boissons", mvtEntete: ["Date", "Désignation"], mvtLignes: [] },
      ],
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Nourriture", "Boissons"]);

    const ws = wb.getWorksheet("Nourriture")!;
    const textes: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => textes.push(String(c.value ?? ""))));
    const joint = textes.join(" | ");
    // KPI, colonnes enrichies, et section mouvements DANS la même feuille.
    expect(joint).toContain("Valeur du stock — Nourriture");
    expect(joint).toContain("Fournisseur");
    expect(joint).toContain("Alerte stock");
    expect(joint).toContain("MOUVEMENTS DU MOIS — Nourriture");
    expect(joint).toContain("Carré d'agneau");
    // Le domaine vide affiche l'absence de mouvement plutôt qu'un tableau fantôme.
    const wsB = wb.getWorksheet("Boissons")!;
    const txtB: string[] = [];
    wsB.eachRow((row) => row.eachCell((c) => txtB.push(String(c.value ?? ""))));
    expect(txtB.join(" | ")).toContain("Aucun mouvement");
  });
});
