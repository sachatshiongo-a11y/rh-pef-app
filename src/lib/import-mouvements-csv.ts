import { normTexte } from "./texte";

// Parseur PUR (sans base de données) d'un CSV d'entrées/sorties de stock. Détecte les colonnes
// par leur intitulé (Date, Code, Désignation, Entrées, Sorties) — tolère un fichier d'inventaire
// à deux tableaux (le tableau des mouvements est repéré à partir de la colonne « Date »).

export type MouvementCsv = { date: string | null; code: string; designation: string; entree: number; sortie: number; ligne: number };
export type ParseMouvementsCsv = { lignes: MouvementCsv[]; erreurs: string[]; colonnes: { date: number; code: number; designation: number; entree: number; sortie: number } | null };

/** Découpe un texte CSV en cellules, en gérant les champs entre guillemets (virgules internes). */
export function decouperCsv(texte: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (inQuotes) {
      if (ch === '"') { if (texte[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === ";") { row.push(field); field = ""; } // tolère aussi le point-virgule
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** « 2 41 » / « 2,41 » / « 1 234,56 » → nombre ; vide → 0. */
export function parseNombre(s: string): number {
  const t = String(s ?? "").replace(/\s| /g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(t.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** « 06/07/2026 » ou « 2026-07-06 » → « 2026-07-06 » (ISO, jour pur). */
export function parseDateFr(s: string): string | null {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

const contient = (cellule: string, mots: string[]) => { const n = normTexte(cellule); return mots.some((mm) => n.includes(mm)); };

/** Analyse le CSV et renvoie les lignes de mouvement (date, code, désignation, entrée, sortie). */
export function parserMouvementsCsv(texte: string): ParseMouvementsCsv {
  const erreurs: string[] = [];
  const rows = decouperCsv(texte).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return { lignes: [], erreurs: ["Fichier vide."], colonnes: null };

  // Repère la ligne d'en-tête : celle qui contient une colonne « Date » ET une colonne « Entrée/Sortie ».
  let enteteIdx = -1, cols: ParseMouvementsCsv["colonnes"] = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i];
    const dateCol = r.findIndex((c) => contient(c, ["date"]));
    if (dateCol < 0) continue;
    // À partir de la colonne Date (cible le tableau des mouvements dans un fichier à deux tableaux).
    const depuis = (pred: (c: string) => boolean) => { for (let j = dateCol; j < r.length; j++) if (pred(r[j])) return j; return -1; };
    const code = depuis((c) => contient(c, ["code"]));
    const designation = depuis((c) => contient(c, ["designation", "libelle", "article"]) && !contient(c, ["code"]));
    const entree = depuis((c) => contient(c, ["entree"]));
    const sortie = depuis((c) => contient(c, ["sortie"]));
    if (designation >= 0 && (entree >= 0 || sortie >= 0)) {
      enteteIdx = i; cols = { date: dateCol, code, designation, entree, sortie }; break;
    }
  }
  if (!cols) return { lignes: [], erreurs: ["En-tête introuvable : le fichier doit contenir des colonnes Date, Désignation et Entrées/Sorties."], colonnes: null };

  const lignes: MouvementCsv[] = [];
  for (let i = enteteIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const at = (idx: number) => (idx >= 0 ? (r[idx] ?? "").trim() : "");
    const designation = at(cols.designation);
    const code = at(cols.code);
    const entree = parseNombre(at(cols.entree));
    const sortie = parseNombre(at(cols.sortie));
    if (!designation && !code) continue; // ligne vide du tableau
    if (entree <= 0 && sortie <= 0) continue; // rien à mouvementer
    lignes.push({ date: parseDateFr(at(cols.date)), code, designation, entree, sortie, ligne: i + 1 });
  }
  if (lignes.length === 0) erreurs.push("Aucune ligne de mouvement (entrée ou sortie) trouvée.");
  return { lignes, erreurs, colonnes: cols };
}
