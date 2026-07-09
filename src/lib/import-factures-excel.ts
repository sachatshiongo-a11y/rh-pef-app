import "server-only";
import ExcelJS from "exceljs";

// Parse un classeur Excel « Suivi des factures fournisseurs » en factures, en détectant les
// colonnes par leur en-tête (gère les formats 2023 et 2024/2025, et les futurs classeurs).

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const alnum = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellVal(cell: any): unknown {
  const v = cell?.value;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return v.result;
    if ("text" in v) return v.text;
    if ("richText" in v) return v.richText.map((t: { text: string }) => t.text).join("");
    return null;
  }
  return v;
}
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const c = String(v).replace(/\s/g, "").replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
  if (c === "" || c === "." || c === "-") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") { const d = new Date(v); if (!isNaN(d.getTime())) return d; }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapColonnes(ws: any): { headerRow: number; col: Record<string, number> } | null {
  for (let r = 8; r <= 14; r++) {
    const row = ws.getRow(r);
    if (alnum(cellVal(row.getCell(1))) !== "fournisseur") continue;
    const col: Record<string, number> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = alnum(cellVal(row.getCell(c)));
      if (!h) continue;
      if (h === "fournisseur") col.fournisseur = c;
      else if (h === "nfacture" || h.startsWith("nfacture")) col.numero = c;
      else if (h === "date") col.date = c;
      else if (h.includes("echeance")) col.echeance = c;
      else if (h.includes("datedepaiement") || h.includes("datepaiement")) col.paiement = c;
      else if (h.includes("montant") && h.includes("facture")) col.montant = c;
      else if (h.includes("montant") && h.endsWith("regler")) col.montant = c;
      else if (h.includes("montant") && h.includes("regle")) col.regle = c;
      else if (h.includes("reste")) col.reste = c;
      else if (h.includes("statut")) col.statut = c;
      else if (h.includes("mode")) col.mode = c;
    }
    if (col.fournisseur && col.montant) return { headerRow: r, col };
  }
  return null;
}

export type FactureImportee = {
  fournisseurNom: string; numero: string | null;
  date: Date | null; dateEcheance: Date | null; datePaiement: Date | null;
  montantUSD: number; montantRegleUSD: number; resteAPayerUSD: number;
  statut: "A_REGLER" | "REGLEE" | "ECHUE_NON_REGLEE"; modePaiement: string | null;
  mois: number; annee: number;
};

/**
 * Parse un classeur Excel. `defautAnnee` sert de repli quand une ligne n'a pas de date.
 * `taux` : les montants ≥ 10 000 sont considérés comme saisis en CDF (impossible en USD pour
 * une facture) et convertis en USD (÷ taux).
 */
export async function parserClasseurFactures(buffer: ArrayBuffer | Buffer, defautAnnee: number, taux: number): Promise<FactureImportee[]> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  const out: FactureImportee[] = [];
  for (const ws of wb.worksheets) {
    const moisIdx = MOIS.indexOf(norm(ws.name));
    if (moisIdx < 0) continue;
    const m = mapColonnes(ws);
    if (!m) continue;
    const { headerRow, col } = m;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const fournisseur = String(cellVal(row.getCell(col.fournisseur)) ?? "").trim();
      let montant = toNum(cellVal(row.getCell(col.montant)));
      if (!fournisseur || montant == null) continue;
      const numeroRaw = col.numero ? cellVal(row.getCell(col.numero)) : null;
      const date = col.date ? toDate(cellVal(row.getCell(col.date))) : null;
      const echeance = col.echeance ? toDate(cellVal(row.getCell(col.echeance))) : null;
      const paiement = col.paiement ? toDate(cellVal(row.getCell(col.paiement))) : null;
      const statutTxt = norm(col.statut ? cellVal(row.getCell(col.statut)) : "");
      let regle = col.regle ? (toNum(cellVal(row.getCell(col.regle))) ?? 0) : null;
      let reste = col.reste ? (toNum(cellVal(row.getCell(col.reste))) ?? 0) : null;

      let statut: FactureImportee["statut"];
      if (statutTxt.includes("echu")) statut = "ECHUE_NON_REGLEE";
      else if (statutTxt.includes("regl")) statut = "REGLEE";
      else statut = echeance && echeance < new Date() ? "ECHUE_NON_REGLEE" : "A_REGLER";

      if (regle == null && reste == null) { reste = statut === "REGLEE" ? 0 : montant; regle = montant - reste; }
      else if (reste == null) { reste = Math.max(0, montant - (regle ?? 0)); }
      else if (regle == null) { regle = Math.max(0, montant - reste); }

      // Conversion CDF → USD si le montant est manifestement en francs.
      if (montant >= 10000 && taux > 0) { montant /= taux; regle = (regle ?? 0) / taux; reste = (reste ?? 0) / taux; }
      const rnd = (x: number) => Math.round(x * 100) / 100;
      montant = rnd(montant); regle = rnd(regle ?? 0); reste = rnd(reste ?? 0);
      if (statut === "REGLEE") reste = 0;

      out.push({
        fournisseurNom: fournisseur,
        numero: numeroRaw == null || String(numeroRaw).trim() === "" ? null : String(numeroRaw).trim(),
        date, dateEcheance: echeance, datePaiement: paiement,
        montantUSD: montant, montantRegleUSD: regle, resteAPayerUSD: reste, statut,
        modePaiement: col.mode ? (cellVal(row.getCell(col.mode)) ? String(cellVal(row.getCell(col.mode))).trim() : null) : null,
        mois: (date ? date.getUTCMonth() : moisIdx) + 1,
        annee: date ? date.getUTCFullYear() : defautAnnee,
      });
    }
  }
  return out;
}
