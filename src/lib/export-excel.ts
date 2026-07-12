import "server-only";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const logoPath = path.join(process.cwd(), "public/logo-pates-en-folie.png");
const OPTIMA = "Optima";
const BRUN = "FF6B4E2E";
const OR_CLAIR = "FFF3E9D8";
const OR_BORDURE = "FFD9C7A8";
const OR_SECTION = "FFEFE4CD"; // fond des lignes-titres de section (catégorie)
const GRIS = "FF888888";

export type FeuilleExcel = {
  nom: string; // nom de l'onglet
  titre?: string; // titre affiché en en-tête (par défaut : titre global)
  entete: string[]; // libellés de colonnes
  lignes: (string | number)[][]; // données
  totauxCols?: number[]; // indices de colonnes à totaliser (ligne « Total » en bas)
  variationCol?: number; // colonne d'écart/variation à colorer (vert ↑ / rouge ↓)
  sectionRows?: number[]; // indices (dans lignes) des lignes-titres de section (catégorie) : fusionnées, en gras
  couleurLigne?: (rowIdx: number) => string | undefined; // fond ARGB d'une ligne de données (ex. code couleur d'alerte)
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

    // Fond de ligne optionnel (codes couleur, ex. alerte de stock) — avant les sections (qui priment).
    if (f.couleurLigne) {
      for (let idx = 0; idx < f.lignes.length; idx++) {
        const argb = f.couleurLigne(idx);
        if (!argb) continue;
        ws.getRow(debutData + idx).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; });
      }
    }

    // Lignes-titres de section (catégorie) : fusionnées sur toute la largeur, en gras, fond or.
    if (f.sectionRows && f.sectionRows.length > 0) {
      for (const idx of f.sectionRows) {
        const rn = debutData + idx;
        ws.mergeCells(rn, 1, rn, f.entete.length);
        const cell = ws.getRow(rn).getCell(1);
        cell.font = { name: OPTIMA, size: 10, bold: true, color: { argb: BRUN } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_SECTION } };
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

export type FeuilleInventaire = {
  nom: string;
  titre: string;
  kpis: { label: string; valeur: string }[]; // bloc KPI en haut, bien visible
  invEntete: string[];
  invLignes: (string | number)[][];
  invTotauxCols?: number[]; // colonnes à totaliser dans le tableau d'inventaire
  alerteCol?: number; // index de la colonne « Alerte stock » à colorer selon le statut
  mvtTitre: string;
  mvtEntete: string[];
  mvtLignes: (string | number)[][];
};

/**
 * Classeur d'inventaire : une feuille par domaine, avec en haut un bloc KPI bien visible, puis
 * le tableau d'inventaire (catégorie, fournisseur, alerte…) et, dans la MÊME feuille, le tableau
 * des mouvements du domaine. Reprend la charte de `classeurExcel` (logo, police, couleurs).
 */
export async function classeurInventaire(opts: { periode: string; feuilles: FeuilleInventaire[] }): Promise<Buffer> {
  const { periode, feuilles } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pâtes en Folie (TOLYA SARL)";
  wb.created = new Date();
  const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;
  const editeLe = new Date().toLocaleDateString("fr-FR");
  const HAUT_LOGO = 3;

  const enteteTable = (ws: ExcelJS.Worksheet, cols: string[]) => {
    const r = ws.addRow(cols);
    r.font = { name: OPTIMA, size: 10, bold: true };
    r.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } };
      cell.border = { bottom: { style: "thin", color: { argb: OR_BORDURE } } };
    });
    return r;
  };
  const bandeau = (ws: ExcelJS.Worksheet, texte: string, largeur: number) => {
    const r = ws.addRow([texte]);
    ws.mergeCells(r.number, 1, r.number, Math.max(1, largeur));
    const cell = r.getCell(1);
    cell.font = { name: OPTIMA, size: 11, bold: true, color: { argb: BRUN } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_SECTION } };
    return r;
  };

  for (const f of feuilles) {
    const largeur = Math.max(f.invEntete.length, f.mvtEntete.length, 4);
    const ws = wb.addWorksheet(f.nom, { views: [{ state: "frozen", ySplit: HAUT_LOGO + 3 }] });
    if (logoBuffer) {
      const id = wb.addImage({ base64: logoBuffer.toString("base64"), extension: "png" });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 165, height: 52 }, editAs: "oneCell" });
    }
    for (let i = 0; i < HAUT_LOGO; i++) ws.addRow([]);
    const rTitre = ws.addRow([`Pâtes en Folie (TOLYA SARL) — ${f.titre}`]);
    rTitre.font = { name: OPTIMA, size: 13, bold: true, color: { argb: BRUN } };
    const rPer = ws.addRow([`Période : ${periode} · Édité le : ${editeLe}`]);
    rPer.font = { name: OPTIMA, size: 9, italic: true, color: { argb: GRIS } };
    ws.addRow([]);

    // Bloc KPI : 2 KPI par ligne (label + valeur en gras, fond or), bien visibles en haut.
    bandeau(ws, "INDICATEURS", largeur);
    for (let i = 0; i < f.kpis.length; i += 2) {
      const a = f.kpis[i], b = f.kpis[i + 1];
      const r = ws.addRow([a.label, a.valeur, "", b?.label ?? "", b?.valeur ?? ""]);
      r.height = 18;
      const style = (col: number, val: boolean) => {
        const c = r.getCell(col);
        c.font = { name: OPTIMA, size: val ? 12 : 10, bold: true, color: { argb: val ? BRUN : "FF000000" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } };
      };
      style(1, false); style(2, true);
      if (b) { style(4, false); style(5, true); }
    }
    ws.addRow([]);

    // Tableau d'inventaire.
    bandeau(ws, `INVENTAIRE — ${f.titre}`, largeur);
    enteteTable(ws, f.invEntete);
    for (const l of f.invLignes) {
      const r = ws.addRow(l);
      // Code couleur du statut de réapprovisionnement (cellule « Alerte stock »).
      if (f.alerteCol != null) {
        const c = r.getCell(f.alerteCol + 1);
        const txt = String(c.value ?? "").toLowerCase();
        const bg = txt.includes("urgent") ? "FFF8D2D5" : txt.includes("réappro") ? "FFFBE7C6" : txt.includes("satisfaisant") ? "FFD6EFDB" : null;
        if (bg) { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.font = { name: OPTIMA, size: 10, bold: true }; }
      }
    }
    if (f.invTotauxCols?.length) {
      const tot: (string | number)[] = new Array(f.invEntete.length).fill("");
      tot[0] = "Total";
      for (const ci of f.invTotauxCols) {
        let s = 0; for (const l of f.invLignes) { const v = Number(l[ci]); if (Number.isFinite(v)) s += v; }
        tot[ci] = Math.round(s * 100) / 100;
      }
      const rt = ws.addRow(tot);
      rt.font = { name: OPTIMA, size: 10, bold: true, color: { argb: BRUN } };
      rt.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } }; cell.border = { top: { style: "thin", color: { argb: OR_BORDURE } } }; });
    }
    ws.addRow([]); ws.addRow([]);

    // Tableau des mouvements du MÊME domaine, dans la même feuille.
    bandeau(ws, f.mvtTitre, largeur);
    enteteTable(ws, f.mvtEntete);
    if (f.mvtLignes.length === 0) ws.addRow(["Aucun mouvement sur la période."]);
    for (const l of f.mvtLignes) ws.addRow(l);

    // Police par défaut sur les cellules non encore stylées (corps des tableaux).
    ws.eachRow((row) => row.eachCell((cell) => { if (!cell.font?.name) cell.font = { name: OPTIMA, size: 10 }; }));

    // Largeurs : basées sur l'entête d'inventaire (le plus large), min pour la 1re colonne.
    const echantillon = [f.invEntete, ...f.invLignes, f.mvtEntete, ...f.mvtLignes];
    for (let i = 0; i < largeur; i++) {
      const longueurs = echantillon.map((l) => String(l[i] ?? "").length);
      ws.getColumn(i + 1).width = Math.min(44, Math.max(9, Math.max(0, ...longueurs) + 2));
    }
    ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 10, 22);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
