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
  totauxCols?: number[]; // indices de colonnes à totaliser (ligne « Total » en bas)
  variationCol?: number; // colonne d'écart/variation à colorer (vert ↑ / rouge ↓)
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

  const HAUT_LOGO = 3; // lignes vides réservées à la hauteur du logo, au-dessus des titres

  for (const f of feuilles) {
    // Gèle l'en-tête (logo + bloc titre + ligne de colonnes) = HAUT_LOGO + 5 lignes.
    const ws = wb.addWorksheet(f.nom, { views: [{ state: "frozen", ySplit: HAUT_LOGO + 5 }] });

    // Logo EN HAUT À GAUCHE, au-dessus des titres.
    if (logoBuffer) {
      const id = wb.addImage({ base64: logoBuffer.toString("base64"), extension: "png" });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 165, height: 52 }, editAs: "oneCell" });
    }

    // Lignes vides sous le logo, puis le bloc d'en-tête (titres SOUS le logo).
    for (let i = 0; i < HAUT_LOGO; i++) ws.addRow([]);
    const rTitre = ws.addRow([`Pâtes en Folie (TOLYA SARL) — ${f.titre ?? titre}`]);
    const rPeriode = ws.addRow([`Période : ${periode}`]);
    const rEdit = ws.addRow([`Édité le : ${editeLe}`]);
    ws.addRow([]);
    const rowEntete = ws.addRow(f.entete);
    const debutData = rowEntete.number + 1;
    for (const l of f.lignes) ws.addRow(l);

    // Ligne « Total » (somme des colonnes indiquées).
    let rTot: ExcelJS.Row | null = null;
    if (f.totauxCols && f.totauxCols.length > 0) {
      const totLigne: (string | number)[] = new Array(f.entete.length).fill("");
      totLigne[0] = "Total";
      for (const ci of f.totauxCols) {
        let s = 0;
        for (const l of f.lignes) { const v = Number(l[ci]); if (Number.isFinite(v)) s += v; }
        totLigne[ci] = Math.round(s * 100) / 100;
      }
      rTot = ws.addRow(totLigne);
    }

    // Police Optima sur toutes les cellules.
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.font = { name: OPTIMA, size: 10 };
      });
    });

    // Mises en forme spécifiques du bloc d'en-tête et de la ligne de colonnes.
    rTitre.font = { name: OPTIMA, size: 13, bold: true, color: { argb: BRUN } };
    rPeriode.font = { name: OPTIMA, size: 10, italic: true };
    rEdit.font = { name: OPTIMA, size: 9, italic: true, color: { argb: GRIS } };
    rowEntete.font = { name: OPTIMA, size: 10, bold: true };
    rowEntete.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } };
      cell.border = { bottom: { style: "thin", color: { argb: OR_BORDURE } } };
    });

    // Écarts / variations plus visibles : vert (↑) / rouge (↓), en gras.
    if (f.variationCol != null) {
      for (let r = debutData; r < debutData + f.lignes.length; r++) {
        const cell = ws.getRow(r).getCell(f.variationCol + 1);
        const txt = String(cell.value ?? "");
        if (txt.includes("↑")) cell.font = { name: OPTIMA, size: 10, bold: true, color: { argb: "FF1B7F3B" } };
        else if (txt.includes("↓")) cell.font = { name: OPTIMA, size: 10, bold: true, color: { argb: "FFB42318" } };
      }
    }

    // Ligne Total en gras, fond or clair.
    if (rTot) {
      rTot.font = { name: OPTIMA, size: 10, bold: true, color: { argb: BRUN } };
      rTot.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } }; cell.border = { top: { style: "thin", color: { argb: OR_BORDURE } } }; });
    }

    // Largeurs de colonnes approximatives d'après le contenu.
    f.entete.forEach((h, i) => {
      const longueurs = [String(h).length, ...f.lignes.map((l) => String(l[i] ?? "").length)];
      ws.getColumn(i + 1).width = Math.min(42, Math.max(10, Math.max(...longueurs) + 2));
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
