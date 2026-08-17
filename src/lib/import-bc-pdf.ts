import "server-only";

// Extrait les infos d'en-tête d'un bon de commande PDF (texte) : numéro, fournisseur, date, total.
// Montants lus quel que soit le format (1 234,56 / 1,234.56 / 1.234,56 / 150.00). Les montants en
// francs (FC/CDF, ou sans « $ » et à l'échelle des milliers) sont convertis en USD via le taux.

const MOIS: Record<string, number> = {
  janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6,
  juil: 7, aout: 8, sept: 9, oct: 10, nov: 11, dec: 12,
};
import { sansAccents as strip } from "./texte";
const round2 = (n: number) => Math.round(n * 100) / 100;
function moisDe(nom: string): number | null {
  const n = strip(nom).toLowerCase();
  for (const k of Object.keys(MOIS)) if (n.startsWith(k)) return MOIS[k];
  return null;
}

export type LigneBonCommande = { designation: string; unite: string | null; quantite: number; prixUnitaireUSD: number; totalLigneUSD: number };

export type BonCommandeExtrait = {
  numero: string | null; sequence: number; mois: number | null; annee: number | null;
  fournisseur: string | null; date: string | null; total: number; lignes: LigneBonCommande[];
};

/**
 * Interprète un montant écrit dans n'importe quel format courant :
 *   « 1 234,56 » « 1,234.56 » « 1.234,56 » « 150.00 » « 150,00 » « 1.500 » (milliers) « 12.5 ».
 * Règle : le dernier séparateur (`.` ou `,`) suivi de 1–2 chiffres est la virgule décimale ;
 * tous les autres `.`/`,`/espaces sont des séparateurs de milliers.
 */
export function parseMontant(s: string): number {
  const t = String(s).replace(/[^\d.,]/g, "");
  if (!t) return NaN;
  const dec = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (dec >= 0) {
    const decimales = t.length - dec - 1;
    const unSeulSep = (t.match(/[.,]/g) || []).length === 1;
    // Décimale si 1–2 chiffres après, OU un seul séparateur avec un nombre de décimales ≠ 3
    // (un groupe de milliers fait toujours exactement 3 chiffres) — ex. « 4.24137931 » = 4,24.
    if ((decimales >= 1 && decimales <= 2) || (unSeulSep && decimales !== 3)) {
      const entier = t.slice(0, dec).replace(/[.,]/g, "");
      return Number(`${entier || "0"}.${t.slice(dec + 1)}`);
    }
  }
  return Number(t.replace(/[.,]/g, ""));
}

// Montants d'une ligne précédés de « $ » (USD) ou « FC/CDF » (francs). PAS d'espace interne : sur une
// ligne d'articles, les colonnes sont séparées par des espaces — les fusionner créerait des nombres géants.
const montantsUSD = (l: string) => [...l.matchAll(/([\d.,]+)\s*\$/g)].map((m) => parseMontant(m[1])).filter((n) => Number.isFinite(n) && n > 0);

/**
 * Extrait les lignes d'articles d'un bon de commande PDF (formats variés).
 * Quantité déduite du nombre N situé avant le prix tel que N × PU ≈ Total (robuste aux colonnes
 * changeantes : Réf/Désignation/Qté/PU/Montant, avec ou sans colonnes cartons).
 */
export function extraireLignesBonCommande(text: string): LigneBonCommande[] {
  const out: LigneBonCommande[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\t/g, " ").replace(/\s{2,}/g, " ").trim();
    if (!l) continue;
    const s = strip(l).toLowerCase();
    if (/^montant total|^total\b|^sous[- ]total|^net a payer/.test(s)) { if (out.length) break; continue; }
    const moneys = montantsUSD(l);
    if (moneys.length === 0) continue;
    const desig = l.replace(/[\d.,]+\s*\$/g, " ").replace(/\b\d[\d.,]*\b/g, " ").replace(/\s{2,}/g, " ").trim();
    if (!/[a-zà-ÿ]{2,}/i.test(desig)) continue; // pas de vraie désignation ⇒ ligne de tableau/total
    const total = moneys[moneys.length - 1];
    const pu = moneys.length >= 2 ? moneys[moneys.length - 2] : total;
    // Nombres situés avant le 1er montant $ : candidats quantité.
    const idx = l.search(/[\d.,]+\s*\$/);
    const avant = idx > 0 ? l.slice(0, idx) : "";
    const nums = [...avant.matchAll(/\b(\d[\d.,]*)\b/g)].map((m) => parseMontant(m[1])).filter((n) => Number.isFinite(n) && n > 0);
    let quantite = 0;
    for (const n of nums) if (pu > 0 && Math.abs(n * pu - total) <= Math.max(0.5, total * 0.03)) { quantite = n; break; }
    if (quantite <= 0) quantite = pu > 0 ? round2(total / pu) : (nums[nums.length - 1] ?? 1);
    if (!Number.isFinite(quantite) || quantite <= 0) quantite = 1;
    out.push({ designation: desig.slice(0, 120), unite: null, quantite, prixUnitaireUSD: pu, totalLigneUSD: total });
  }
  return out;
}

/**
 * Total du bon de commande. Le total général figure sur sa PROPRE ligne, réduite à un montant
 * (parfois précédé de « TOTAL » / « Montant total »), ex. « 1 112,02 $ », « 130,00 $ »,
 * « TOTAL 447.00 $ ». On parcourt ces lignes « montant pur » (le nombre entier, espaces = milliers,
 * y est fiable) : on prend celle libellée « total », sinon la dernière. FC converti en USD au besoin.
 */
export function extraireTotalBonCommande(text: string, tauxCDF: number): number {
  // Ligne = label facultatif (TOTAL/MONTANT…) + un nombre + devise, et RIEN d'autre.
  const reUSD = /^(?:montant\s+total|total(?:\s+(?:ttc|net|general|generale|a\s+payer|à\s+payer))?|net\s+à?\s*payer)?\s*(\d[\d\s.,]*\d|\d)\s*\$$/;
  const reFC = /^(?:montant\s+total|total(?:\s+(?:ttc|net|general|generale|a\s+payer|à\s+payer))?|net\s+à?\s*payer)?\s*(\d[\d\s.,]*\d|\d)\s*(?:fc|cdf|frs?)$/;
  let dernierUSD = NaN, dernierFC = NaN, labelUSD = NaN, labelFC = NaN;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\s{2,}/g, " ").trim();
    if (!l) continue;
    const s = strip(l).toLowerCase();
    const estLabel = /total|montant|net/.test(s);
    const mu = s.match(reUSD);
    if (mu) { const v = parseMontant(mu[1]); if (v > 0) { dernierUSD = v; if (estLabel) labelUSD = v; } continue; }
    const mf = s.match(reFC);
    if (mf) { const v = parseMontant(mf[1]); if (v > 0) { dernierFC = v; if (estLabel) labelFC = v; } }
  }
  if (Number.isFinite(labelUSD)) return round2(labelUSD);
  if (Number.isFinite(labelFC) && tauxCDF > 0) return round2(labelFC / tauxCDF);
  if (Number.isFinite(dernierUSD)) return round2(dernierUSD);
  if (Number.isFinite(dernierFC) && tauxCDF > 0) return round2(dernierFC / tauxCDF);
  return 0;
}

export async function extraireBonCommandePDF(buffer: ArrayBuffer, tauxCDF: number): Promise<BonCommandeExtrait> {
  // Import dynamique (module externe Node) pour éviter le bundling par Next.
  const mod = (await import("pdf-parse")) as unknown as { PDFParse: new (o: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> } };
  const parser = new mod.PDFParse({ data: new Uint8Array(buffer) });
  const { text } = await parser.getText();

  let numero: string | null = null, sequence = 0, mois: number | null = null, annee: number | null = null;
  const m = text.match(/BON DE COMMANDE N[°o ]*([0-9]+)[/:]([A-Za-zÉÈéè]+)[/:]([A-Za-zÉÈéè]+)[/:]([0-9]{2,4})/);
  if (m) {
    sequence = parseInt(m[1], 10);
    const moisNom = m[3], yy = m[4];
    annee = yy.length === 4 ? parseInt(yy, 10) : 2000 + parseInt(yy, 10);
    mois = moisDe(moisNom);
    numero = `${m[1]}/PEF/${moisNom.toUpperCase()}/${yy}`;
  }
  const fm = text.match(/Nom\s*:\s*([A-Za-z0-9 &.\-']+?)\s*(?:Nom|Pays)/);
  const fournisseur = fm ? fm[1].replace(/\s+/g, " ").trim() : null;

  let date: string | null = null;
  const dm = text.match(/Date\s*:?\s*([0-3]?\d)[/.\-]([01]?\d)[/.\-](\d{2,4})/);
  if (dm) {
    const yy = dm[3].length === 4 ? dm[3] : "20" + dm[3];
    date = `${yy}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    if (annee == null) annee = parseInt(yy, 10);
    if (mois == null) mois = parseInt(dm[2], 10);
  }

  const total = extraireTotalBonCommande(text, tauxCDF);
  const lignes = extraireLignesBonCommande(text);
  return { numero, sequence, mois, annee, fournisseur, date, total, lignes };
}
