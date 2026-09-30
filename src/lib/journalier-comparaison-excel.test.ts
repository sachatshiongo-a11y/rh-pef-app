import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { classeurExcel } from "@/lib/export-excel";
import { lignesExportComparaison } from "./journalier-restaurant";
import { feuilleExcelComparaison } from "./journalier-comparaison-export";
import { LABELS_FIXTURE, lignesFixture } from "@/app/(stock)/stock/journalier/comparaison.fixture";

// Classeur Excel de la Comparaison : deux niveaux d'en-tête (le jour, puis Cmd / Livré / Conso), volet
// figé (en-têtes ET colonne Article), jours séparés par un filet et alternés de fond, écart signé à
// côté de la valeur, et JAMAIS d'autofiltre (les lignes-titres de rubrique se mélangeraient au tri).

async function feuille() {
  const d = lignesExportComparaison(lignesFixture(40), LABELS_FIXTURE);
  const buf = await classeurExcel({
    titre: "Comparaison commandé / livré / consommé", periode: "Semaine du 21/9 au 27/9",
    feuilles: [{ nom: "Comparaison", ...feuilleExcelComparaison({ ...d, enteteCourt: d.enteteCourt, groupesEntete: d.groupes }) }],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return { ws: wb.getWorksheet("Comparaison")!, d };
}
const ligneDe = (ws: ExcelJS.Worksheet, texte: string) => { let n = 0; ws.eachRow((r, i) => { if (r.getCell(1).value === texte) n = i; }); return n; };

describe("Excel de la comparaison", () => {
  it("deux niveaux d'en-tête : un groupe fusionné par jour et pour le total, puis Cmd / Livré / Conso", async () => {
    const { ws } = await feuille();
    const entete = ligneDe(ws, "Article");
    expect(entete).toBeGreaterThan(1);
    const groupes = ws.getRow(entete - 1);
    expect([2, 5, 8, 11, 14, 17, 20, 23].map((c) => groupes.getCell(c).value)).toEqual([...LABELS_FIXTURE, "Total"]);
    const fusions = ws.model.merges as string[];
    const g = entete - 1;
    for (const [de, a] of [["B", "D"], ["E", "G"], ["T", "V"], ["W", "Y"]]) expect(fusions, `${de}${g}:${a}${g}`).toContain(`${de}${g}:${a}${g}`);
    const cols = [2, 3, 4, 23, 24, 25].map((c) => ws.getRow(entete).getCell(c).value);
    expect(cols).toEqual(["Cmd", "Livré", "Conso", "Cmd", "Livré", "Conso"]);
  });

  it("le volet est figé sous les deux lignes d'en-tête et après la colonne Article ; aucun autofiltre", async () => {
    const { ws } = await feuille();
    const entete = ligneDe(ws, "Article");
    const vue = ws.views[0]!;
    expect(vue.state).toBe("frozen");
    expect(vue).toMatchObject({ xSplit: 1, ySplit: entete });
    expect(ws.autoFilter).toBeFalsy();
  });

  it("les jours sont séparés (filet gauche marqué) et alternés de fond ; l'écart est signé à côté de la valeur", async () => {
    const { ws, d } = await feuille();
    const entete = ligneDe(ws, "Article");
    const premiere = entete + 2; // après la rubrique
    for (const c of [2, 5, 8, 23]) expect(ws.getRow(premiere).getCell(c).border?.left?.style, `colonne ${c}`).toBe("medium");
    expect(ws.getRow(premiere).getCell(3).border?.left?.style).toBeUndefined();
    // Valeur écrite en texte, alignée à droite.
    expect(ws.getRow(premiere).getCell(3).alignment?.horizontal).toBe("right");
    // Chaque cellule en écart de consommé se lit « valeur (signe) ».
    let vues = 0;
    for (const [cle, e] of d.signes) {
      const [r, c] = cle.split(":").map(Number) as [number, number];
      const ligneDonnees = entete + 1 + r;
      expect(String(ws.getRow(ligneDonnees).getCell(c + 1).value)).toBe(`${d.lignes[r]![c]} (${e.signe})`);
      vues++;
    }
    expect(vues).toBeGreaterThan(20);
  });
});
