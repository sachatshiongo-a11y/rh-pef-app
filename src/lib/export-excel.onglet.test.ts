import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { classeurExcel, nomOngletExcel } from "./export-excel";

// 2026-10-09 : l'Excel de la Comparaison plantait (« Le document n'a pas pu être récupéré ») —
// l'onglet reprenait le titre « Comparaison commandé / livré / consommé », et Excel refuse « / ».
describe("nom d'onglet Excel", () => {
  it("retire les caractères interdits par Excel", () => {
    expect(nomOngletExcel("Comparaison commandé / livré")).toBe("Comparaison commandé - livré");
    expect(nomOngletExcel("a*b?c:d\\e/f[g]h")).toBe("a-b-c-d-e-f-g-h");
  });
  it("31 caractères au plus, jamais vide, sans apostrophe aux bords", () => {
    expect(nomOngletExcel("x".repeat(40))).toHaveLength(31);
    expect(nomOngletExcel("   ")).toBe("Feuille");
    expect(nomOngletExcel("'Bar'")).toBe("Bar");
  });
  it("unique dans le classeur (sans tenir compte de la casse)", () => {
    const pris = new Set<string>();
    expect(nomOngletExcel("Cuisine", pris)).toBe("Cuisine");
    expect(nomOngletExcel("cuisine", pris)).toBe("cuisine (2)");
    expect(nomOngletExcel("Cuisine", pris)).toBe("Cuisine (3)");
  });
  it("le classeur de la Comparaison se construit et se relit", async () => {
    const titre = "Comparaison commandé / livré / consommé";
    const buf = await classeurExcel({
      titre, periode: "Semaine du 5/10 au 11/10",
      feuilles: [{ nom: titre.slice(0, 28), entete: ["Article", "Cmd"], lignes: [["Riz", "1"]] }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Comparaison commandé - livré"]);
  });
});
