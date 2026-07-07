import "server-only";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const logoPath = path.join(process.cwd(), "public/logo-pates-en-folie.png");
const OPTIMA = "Optima";
const BRUN = "FF6B4E2E";
const OR_CLAIR = "FFF3E9D8";
const OR_BORDURE = "FFD9C7A8";
const GRIS = "FF888888";

export type FeuilleExcel = {
  nom: string; // nom de l'onglet
  titre?: string; // titre affiché en en-tête (par défaut : titre global)
  entete: string[]; // libellés de colonnes
  lignes: (string | number)[][]; // données
};

/**
 * Construit un classeur Excel harmonisé : police Optima partout, logo en haut à droite, bloc
 * d'en-tête (société, période, date d'export) et ligne de colonnes mise en valeur. Une ou
 * plusieurs feuilles. Remplace l'ancienne génération via SheetJS (qui ne gérait ni police ni image).
 *
 * Note : la police Optima ne s'affiche que si elle est installée sur le poste qui ouvre le fichier
 * (macOS l'a par défaut) ; sinon Excel la remplace par une police proche.
 */
export async function classeurExcel(opts: {
  titre: string;
  periode: string;
  feuilles: FeuilleExcel[];
}): Promise<Buffer> {
  const { titre, periode, feuilles } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pâtes en Folie (TOLYA SARL)";
  wb.created = new Date();

  const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;
  const editeLe = new Date().toLocaleDateString("fr-FR");

  for (const f of feuilles) {
    const ws = wb.addWorksheet(f.nom, { views: [{ state: "frozen", ySplit: 5 }] });
    const nbCols = Math.max(1, f.entete.length);

    // Logo en haut à droite (ancré vers les dernières colonnes de la zone d'en-tête).
    if (logoBuffer) {
      const id = wb.addImage({ base64: logoBuffer.toString("base64"), extension: "png" });
      ws.addImage(id, {
        tl: { col: Math.max(0, nbCols - 3), row: 0 },
        ext: { width: 160, height: 50 },
        editAs: "oneCell",
      });
    }

    // Bloc d'en-tête.
    ws.addRow([`Pâtes en Folie (TOLYA SARL) — ${f.titre ?? titre}`]);
    ws.addRow([`Période : ${periode}`]);
    ws.addRow([`Édité le : ${editeLe}`]);
    ws.addRow([]);
    const rowEntete = ws.addRow(f.entete);
    for (const l of f.lignes) ws.addRow(l);

    // Police Optima sur toutes les cellules.
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.font = { name: OPTIMA, size: 10 };
      });
    });

    // Mises en forme spécifiques du bloc d'en-tête et de la ligne de colonnes.
    ws.getRow(1).font = { name: OPTIMA, size: 13, bold: true, color: { argb: BRUN } };
    ws.getRow(2).font = { name: OPTIMA, size: 10, italic: true };
    ws.getRow(3).font = { name: OPTIMA, size: 9, italic: true, color: { argb: GRIS } };
    rowEntete.font = { name: OPTIMA, size: 10, bold: true };
    rowEntete.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } };
      cell.border = { bottom: { style: "thin", color: { argb: OR_BORDURE } } };
    });

    // Largeurs de colonnes approximatives d'après le contenu.
    f.entete.forEach((h, i) => {
      const longueurs = [String(h).length, ...f.lignes.map((l) => String(l[i] ?? "").length)];
      ws.getColumn(i + 1).width = Math.min(42, Math.max(10, Math.max(...longueurs) + 2));
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
