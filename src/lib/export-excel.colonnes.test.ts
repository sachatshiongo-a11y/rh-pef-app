import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { classeurExcel, colonnesDeMontant } from "./export-excel";

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
    expect(src, "le livre de paie Excel n'a plus de ligne Total").toMatch(/const colsMontant = colonnesDeMontant\(ENTETE_LIVRE_EXCEL\)/);
    expect(src, "le livre de paie Excel n'a plus de ligne Total").toMatch(/totauxCols:\s*colsMontant/);
    const route = fs.readFileSync(path.join(__dirname, "../app/(app)/paie/export/route.ts"), "utf8");
    expect(route, "la route du livre de paie ne passe plus par classeurLivrePaie").toMatch(/classeurLivrePaie\(/);
  });
});
