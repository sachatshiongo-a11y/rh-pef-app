import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { classeurExcel, colonnesATotaliser, colonnesDeMontant, colonnesDeQuantite } from "./export-excel";

// En-têtes du livre de paie avant l'ajout des heures supp. (le livre réel est testé dans livre-paie.test.ts).
const ENTETE_LIVRE = [
  "Matricule", "Nom", "Catégorie", "Salaire brut $", "CNSS salarié $", "IPR $", "Transport $",
  "Salaire net $", "Salaire net CDF", "Total versé $", "Total versé CDF", "Statut",
];

describe("colonnesDeMontant", () => {
  it("retient toutes les colonnes de montant du livre de paie, et elles seules", () => {
    expect(colonnesDeMontant(ENTETE_LIVRE)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it("ignore le texte, même s'il contient un $ au milieu", () => {
    expect(colonnesDeMontant(["Nom", "Note ($ en cash)", "Montant $"])).toEqual([2]);
  });
});

describe("colonnesDeQuantite / colonnesATotaliser", () => {
  it("retient les heures et les jours, jamais un taux, un prix unitaire ou un libellé", () => {
    const entete = ["Nom", "Heures supp. (h)", "Congés (j)", "Taux (%)", "Prix (U)", "Note (h) ajoutée", "Brut $", "Statut"];
    expect(colonnesDeQuantite(entete)).toEqual([1, 2]);
    expect(colonnesATotaliser(entete)).toEqual([1, 2, 6]);
  });
});

describe("le livre de paie Excel porte une ligne Total juste", () => {
  it("additionne chaque colonne de montant en bas du tableau", async () => {
    const lignes = [
      ["M1", "A", "BRIGADE", 450.5, 22.5, 10, 30, 400, 1120000, 430, 1204000, "Payé"],
      ["M2", "B", "BACKOFFICE", 300.25, 15, 5.1, 0, 280.15, 784420, 280.15, 784420, "Validé"],
    ];
    const buf = await classeurExcel({
      titre: "Livre de paie",
      periode: "septembre 2026",
      feuilles: [{ nom: "Paie", entete: ENTETE_LIVRE, lignes, totauxCols: colonnesDeMontant(ENTETE_LIVRE) }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer); // même idiome que export-excel.test.ts
    const ws = wb.getWorksheet("Paie")!;
    let total: ExcelJS.Row | undefined;
    ws.eachRow((r) => { if (r.getCell(1).value === "Total") total = r; });
    expect(total, "aucune ligne « Total » dans le livre de paie").toBeDefined();
    const v = (col: number) => total!.getCell(col + 1).value;
    expect(v(3)).toBe(750.75);   // brut
    expect(v(4)).toBe(37.5);     // CNSS
    expect(v(5)).toBe(15.1);     // IPR
    expect(v(6)).toBe(30);       // transport
    expect(v(7)).toBe(680.15);   // net $
    expect(v(8)).toBe(1904420);  // net CDF
    expect(v(9)).toBe(710.15);   // versé $
    expect(v(10)).toBe(1988420); // versé CDF
    expect(v(11) ?? "").toBe(""); // le statut n'est pas « additionné »
  }, 30_000);
});

describe("le livre de paie Excel demande bien ses totaux", () => {
  it("chaque onglet de catégorie passe totauxCols, calculés d'après ses propres en-têtes", () => {
    const src = fs.readFileSync(path.join(__dirname, "livre-paie-excel.ts"), "utf8");
    expect(src, "le livre de paie Excel n'a plus de ligne Total").toMatch(/const colsTotal = colonnesATotaliser\(ENTETE_LIVRE_EXCEL\)/);
    expect(src, "le livre de paie Excel n'a plus de ligne Total").toMatch(/totauxCols:\s*colsTotal/);
    const route = fs.readFileSync(path.join(__dirname, "../app/(app)/paie/export/route.ts"), "utf8");
    expect(route, "la route du livre de paie ne passe plus par classeurLivrePaie").toMatch(/classeurLivrePaie\(/);
  });
});

/**
 * Volet figé et logo : réglés dans l'aide PARTAGÉE, donc valables pour tous les exports qui passent
 * par classeurExcel / classeurInventaire (paie, présences, planning, stock, déclarations…).
 */
describe("classeurExcel — volet figé sous la ligne de colonnes, un seul logo", () => {
  it("chaque feuille gèle jusqu'à sa ligne de colonnes incluse, quelle que soit sa forme", async () => {
    const buf = await classeurExcel({
      titre: "Essai",
      periode: "septembre 2026",
      feuilles: [
        { nom: "Simple", entete: ["A", "B $"], lignes: [["x", 1], ["y", 2]], totauxCols: [1] },
        { nom: "Sections", entete: ["A", "B"], lignes: [["Section"], ["x", "y"]], sectionRows: [0] },
        { nom: "Vide", entete: ["A"], lignes: [], messageVide: "Rien" },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBe(3);
    for (const ws of wb.worksheets) {
      let rangEntete = 0;
      ws.eachRow((r, n) => { if (!rangEntete && r.getCell(1).value === "A") rangEntete = n; });
      expect(rangEntete, ws.name).toBeGreaterThan(0);
      const vue = ws.views[0] as { state?: string; ySplit?: number };
      expect(vue.state, ws.name).toBe("frozen");
      expect(vue.ySplit, `${ws.name} : la ligne de colonnes doit rester visible`).toBe(rangEntete);
    }
    expect((wb.model as unknown as { media: unknown[] }).media.length, "un PNG par onglet").toBe(1);
    for (const ws of wb.worksheets) expect(ws.getImages().length, ws.name).toBe(1);
  }, 30_000);
});
