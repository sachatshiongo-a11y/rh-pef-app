import "server-only";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { jourKinshasa } from "@/lib/heure-kinshasa";

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
  couleurTexteCellule?: (rowIdx: number, colIdx: number) => string | undefined; // couleur ARGB du texte d'une cellule (ex. commande verte / livraison rouge)
  libelleTotal?: string; // libellé de la ligne de totaux (par défaut « Total »)
  messageVide?: string; // écrit sous l'en-tête quand `lignes` est vide (ex. « Aucun salarié ») — la ligne de totaux reste, à 0
  /**
   * Autofiltre sur l'en-tête, BORNÉ AUX LIGNES DE DONNÉES : la ligne de totaux (et le message de
   * feuille vide) restent HORS de la plage, sinon un tri les enverrait au milieu des données — le
   * chiffre serait toujours là, à la mauvaise place. Réservé aux feuilles sans lignes-titres de
   * section (un tri les mélangerait aussi) ; sans ligne de données, aucun filtre n'est posé.
   */
  autofiltre?: boolean;
  /**
   * Colonnes de montant affichées au format maison : séparateur de milliers, deux décimales,
   * négatif entre parenthèses et en rouge (jamais « − »). La cellule reste un NOMBRE calculable.
   */
  colonnesMontantFormat?: number[];
  /** Lignes (indices dans `lignes`) en gras : sous-totaux et totaux écrits dans les données. */
  lignesGras?: number[];
  /** Colonnes figées à gauche (libellés) en plus des lignes d'en-tête : un tableau de douze mois
   *  défile vers la droite sans perdre le nom du poste. */
  figerColonnes?: number;
  /** Format Excel d'une cellule NUMÉRIQUE précise (ex. « 0,0 % » pour un ratio), prioritaire sur
   *  `colonnesMontantFormat` : quand une même colonne porte des ratios et des montants. */
  formatCellule?: (rowIdx: number, colIdx: number) => string | undefined;
  /**
   * Deuxième niveau d'en-tête : une ligne AU-DESSUS de la ligne de colonnes, où chaque groupe
   * (`debut` = indice de la première colonne, `nb` colonnes) porte un libellé fusionné (un jour, par
   * exemple). Les groupes voisins alternent de fond ; le volet figé descend sous les DEUX lignes.
   */
  groupesEntete?: { libelle: string; debut: number; nb: number }[];
  /** Fond ARGB d'une cellule de donnée (jours alternés, écarts) ; prioritaire sur `couleurLigne`, avant les sections. */
  fondCellule?: (rowIdx: number, colIdx: number) => string | undefined;
  /** Colonnes qui commencent un groupe : filet gauche marqué, de l'en-tête à la dernière ligne de données. */
  filetGaucheCols?: number[];
  /** Colonnes alignées à droite (valeurs écrites en texte : Excel les alignerait à gauche). */
  alignerADroite?: number[];
};

/** Format Excel des ratios : une décimale, en pourcentage (0,264 → 26,4 %). La cellule reste un nombre. */
export const FORMAT_POURCENT_EXCEL = "0.0 %";

/** Format Excel des montants : milliers, 2 décimales, négatif = parenthèses rouges. */
export const FORMAT_MONTANT_EXCEL = "#,##0.00;[Red](#,##0.00)";

/**
 * Indices des colonnes de montant d'un tableau, repérées par leur EN-TÊTE (« … $ », « … CDF »),
 * jamais par leur position : ajouter ou déplacer une colonne ne décale aucun total.
 */
export function colonnesDeMontant(entete: string[]): number[] {
  return entete.flatMap((h, i) => (/(\$|CDF)$/.test(h.trim()) ? [i] : []));
}

/**
 * Colonnes de QUANTITÉ additionnables, repérées elles aussi par leur en-tête : une unité entre
 * parenthèses en fin de libellé (« Heures supp. (h) », « Congés (j) »). Liste FERMÉE d'unités :
 * un libellé comme « Taux (%) » ou « Prix (U) » ne s'additionne pas et n'y entre jamais.
 */
export function colonnesDeQuantite(entete: string[]): number[] {
  return entete.flatMap((h, i) => (/\((h|j)\)$/.test(h.trim()) ? [i] : []));
}

/** Tout ce qui se totalise en bas d'un tableau : montants et quantités, dans l'ordre des colonnes. */
export function colonnesATotaliser(entete: string[]): number[] {
  return [...colonnesDeQuantite(entete), ...colonnesDeMontant(entete)].sort((a, b) => a - b);
}

/**
 * Logo ajouté UNE fois au classeur ; chaque feuille le référence par son identifiant. L'ajouter
 * dans la boucle des feuilles embarquait une copie du PNG par onglet (livre de paie : 81 → 228 Ko).
 */
function logoDuClasseur(wb: ExcelJS.Workbook): number | null {
  if (!fs.existsSync(logoPath)) return null;
  return wb.addImage({ base64: fs.readFileSync(logoPath).toString("base64"), extension: "png" });
}

/**
 * Construit un classeur Excel harmonisé : police Optima partout, logo en haut à droite, bloc
 * d'en-tête (société, période, date d'export) et ligne de colonnes mise en valeur. Une ou
 * plusieurs feuilles. Remplace l'ancienne génération via SheetJS (qui ne gérait ni police ni image).
 *
 * Note : la police Optima ne s'affiche que si elle est installée sur le poste qui ouvre le fichier
 * (macOS l'a par défaut) ; sinon Excel la remplace par une police proche.
 */
/**
 * Nom d'onglet que Excel accepte : sans `* ? : \ / [ ]`, sans apostrophe en tête ni en fin, 31
 * caractères au plus, unique dans le classeur (Excel ne distingue pas la casse). Un titre d'écran
 * passé tel quel (« Comparaison commandé / livré / consommé ») faisait PLANTER tout l'export
 * (constaté le 2026-10-09 sur l'Excel de la Comparaison).
 */
export function nomOngletExcel(nom: string, dejaPris: Set<string> = new Set()): string {
  const base = (nom.replace(/[*?:\\/\[\]]/g, "-").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "") || "Feuille").slice(0, 31).trim();
  let candidat = base;
  for (let i = 2; dejaPris.has(candidat.toLowerCase()); i++) {
    const suffixe = ` (${i})`;
    candidat = base.slice(0, 31 - suffixe.length).trim() + suffixe;
  }
  dejaPris.add(candidat.toLowerCase());
  return candidat;
}

export async function classeurExcel(opts: {
  titre: string;
  periode: string;
  feuilles: FeuilleExcel[];
}): Promise<Buffer> {
  const { titre, periode, feuilles } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pâtes en Folie (TOLYA SARL)";
  wb.created = new Date();

  const editeLe = jourKinshasa(new Date());
  const logoId = logoDuClasseur(wb);

  const HAUT_LOGO = 3; // lignes vides réservées à la hauteur du logo, au-dessus des titres

  const onglets = new Set<string>();
  for (const f of feuilles) {
    const ws = wb.addWorksheet(nomOngletExcel(f.nom, onglets));

    // Logo EN HAUT À GAUCHE, au-dessus des titres : la MÊME image, référencée par chaque feuille.
    if (logoId != null) ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 165, height: 52 }, editAs: "oneCell" });

    // Lignes vides sous le logo, puis le bloc d'en-tête (titres SOUS le logo).
    for (let i = 0; i < HAUT_LOGO; i++) ws.addRow([]);
    const rTitre = ws.addRow([`Pâtes en Folie (TOLYA SARL) — ${f.titre ?? titre}`]);
    const rPeriode = ws.addRow([`Période : ${periode}`]);
    const rEdit = ws.addRow([`Édité le : ${editeLe}`]);
    ws.addRow([]);
    const rowGroupes = f.groupesEntete ? ws.addRow([]) : null;
    if (rowGroupes && f.groupesEntete) {
      f.groupesEntete.forEach((g, gi) => {
        const cell = rowGroupes.getCell(g.debut + 1);
        cell.value = g.libelle;
        if (g.nb > 1) ws.mergeCells(rowGroupes.number, g.debut + 1, rowGroupes.number, g.debut + g.nb);
        cell.font = { name: OPTIMA, size: 10, bold: true, color: { argb: BRUN } };
        cell.alignment = { horizontal: "center" };
        for (let k = 0; k < g.nb; k++) rowGroupes.getCell(g.debut + 1 + k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: gi % 2 === 0 ? OR_BORDURE : OR_CLAIR } };
      });
    }
    const rowEntete = ws.addRow(f.entete);
    // Gèle tout ce qui précède les données, ligne de colonnes COMPRISE. Calculé sur la ligne réelle,
    // jamais compté à la main : l'ancien « HAUT_LOGO + 5 » valait 8 alors que la ligne de colonnes
    // arrive en ligne 9 dans le fichier produit — elle défilait avec les données.
    ws.views = [{ state: "frozen", ySplit: rowEntete.number, ...(f.figerColonnes ? { xSplit: f.figerColonnes } : {}) }];
    const debutData = rowEntete.number + 1;
    for (const l of f.lignes) ws.addRow(l);
    const rVide = f.lignes.length === 0 && f.messageVide ? ws.addRow([f.messageVide]) : null;
    if (f.autofiltre && f.sectionRows?.length) throw new Error(`Feuille « ${f.nom} » : autofiltre incompatible avec des lignes-titres de section`);
    if (f.autofiltre && f.lignes.length > 0) {
      // Dernière ligne filtrée = dernière ligne de DONNÉES, jamais la ligne de totaux ajoutée plus bas.
      ws.autoFilter = { from: { row: rowEntete.number, column: 1 }, to: { row: debutData + f.lignes.length - 1, column: f.entete.length } };
    }

    // Ligne « Total » (somme des colonnes indiquées).
    let rTot: ExcelJS.Row | null = null;
    if (f.totauxCols && f.totauxCols.length > 0) {
      const totLigne: (string | number)[] = new Array(f.entete.length).fill("");
      totLigne[0] = f.libelleTotal ?? "Total";
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
    if (rVide) rVide.font = { name: OPTIMA, size: 10, italic: true, color: { argb: GRIS } };
    rowEntete.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_CLAIR } };
      cell.border = { bottom: { style: "thin", color: { argb: OR_BORDURE } } };
    });
    for (const ci of f.alignerADroite ?? []) rowEntete.getCell(ci + 1).alignment = { horizontal: "right" };
    f.groupesEntete?.forEach((g, gi) => {
      if (gi % 2 !== 0) return;
      for (let k = 0; k < g.nb; k++) rowEntete.getCell(g.debut + 1 + k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: OR_BORDURE } };
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

    // Fond par cellule (jours alternés, écarts) — avant les sections (qui priment).
    if (f.fondCellule) {
      for (let idx = 0; idx < f.lignes.length; idx++) {
        const row = ws.getRow(debutData + idx);
        for (let ci = 0; ci < f.entete.length; ci++) {
          const argb = f.fondCellule(idx, ci);
          if (argb) row.getCell(ci + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        }
      }
    }

    // Couleur de texte par cellule (ex. commande verte / livraison rouge).
    if (f.couleurTexteCellule) {
      for (let idx = 0; idx < f.lignes.length; idx++) {
        const row = ws.getRow(debutData + idx);
        for (let ci = 0; ci < f.entete.length; ci++) {
          const argb = f.couleurTexteCellule(idx, ci);
          if (argb) row.getCell(ci + 1).font = { name: OPTIMA, size: 10, bold: true, color: { argb } };
        }
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

    // Valeurs à droite et filets gauches des groupes (jours) : sur les lignes de données, pas sur les titres de section fusionnés.
    if (f.alignerADroite?.length || f.filetGaucheCols?.length) {
      const sections = new Set(f.sectionRows ?? []);
      for (let idx = 0; idx < f.lignes.length; idx++) {
        if (sections.has(idx)) continue;
        const row = ws.getRow(debutData + idx);
        for (const ci of f.alignerADroite ?? []) row.getCell(ci + 1).alignment = { horizontal: "right" };
        for (const ci of f.filetGaucheCols ?? []) row.getCell(ci + 1).border = { ...row.getCell(ci + 1).border, left: { style: "medium", color: { argb: OR_BORDURE } } };
      }
      for (const ci of f.filetGaucheCols ?? []) {
        for (const r of [rowGroupes, rowEntete]) if (r) r.getCell(ci + 1).border = { ...r.getCell(ci + 1).border, left: { style: "medium", color: { argb: OR_BORDURE } } };
      }
    }

    // Montants au format maison (nombres conservés, seul l'affichage change).
    if (f.colonnesMontantFormat?.length) {
      const derniere = rTot ? rTot.number : debutData + f.lignes.length - 1;
      for (let r = debutData; r <= derniere; r++) {
        for (const ci of f.colonnesMontantFormat) {
          const cell = ws.getRow(r).getCell(ci + 1);
          if (typeof cell.value === "number") cell.numFmt = FORMAT_MONTANT_EXCEL;
        }
      }
    }

    // Formats cellule par cellule (ratios en % dans une colonne de montants…).
    if (f.formatCellule) {
      for (let idx = 0; idx < f.lignes.length; idx++) {
        for (let ci = 0; ci < f.entete.length; ci++) {
          const fmt = f.formatCellule(idx, ci);
          const cell = ws.getRow(debutData + idx).getCell(ci + 1);
          if (fmt && typeof cell.value === "number") cell.numFmt = fmt;
        }
      }
    }

    // Sous-totaux et totaux écrits dans les données : en gras.
    for (const idx of f.lignesGras ?? []) {
      ws.getRow(debutData + idx).eachCell((cell) => { cell.font = { ...cell.font, name: OPTIMA, size: 10, bold: true }; });
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
  const editeLe = jourKinshasa(new Date());
  const logoId = logoDuClasseur(wb);
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

  const onglets = new Set<string>();
  for (const f of feuilles) {
    const largeur = Math.max(f.invEntete.length, f.mvtEntete.length, 4);
    const ws = wb.addWorksheet(nomOngletExcel(f.nom, onglets));
    if (logoId != null) ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 165, height: 52 }, editAs: "oneCell" });
    for (let i = 0; i < HAUT_LOGO; i++) ws.addRow([]);
    const rTitre = ws.addRow([`Pâtes en Folie (TOLYA SARL) — ${f.titre}`]);
    rTitre.font = { name: OPTIMA, size: 13, bold: true, color: { argb: BRUN } };
    const rPer = ws.addRow([`Période : ${periode} · Édité le : ${editeLe}`]);
    rPer.font = { name: OPTIMA, size: 9, italic: true, color: { argb: GRIS } };
    // Gèle le bloc titre (les tableaux de la feuille commencent plus bas, à des hauteurs variables).
    ws.views = [{ state: "frozen", ySplit: rPer.number }];
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
