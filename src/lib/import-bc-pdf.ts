import "server-only";

// Extrait les infos d'en-tête d'un bon de commande PDF (texte) : numéro, fournisseur, date, total.
// Les montants ≥ 10 000 sont considérés comme des francs et convertis en USD.

const MOIS: Record<string, number> = {
  janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6,
  juil: 7, aout: 8, sept: 9, oct: 10, nov: 11, dec: 12,
};
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
function moisDe(nom: string): number | null {
  const n = strip(nom).toLowerCase();
  for (const k of Object.keys(MOIS)) if (n.startsWith(k)) return MOIS[k];
  return null;
}

export type BonCommandeExtrait = {
  numero: string | null; sequence: number; mois: number | null; annee: number | null;
  fournisseur: string | null; date: string | null; total: number;
};

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

  let total = 0;
  const amounts = [...text.matchAll(/([0-9][0-9.,\s]*)\s*\$/g)].map((a) => a[1]);
  if (amounts.length) {
    const raw = amounts[amounts.length - 1].trim().replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
    const t2 = Number(raw);
    if (Number.isFinite(t2)) {
      if (t2 >= 10000 && tauxCDF > 0) total = Math.round((t2 / tauxCDF) * 100) / 100;
      else if (t2 >= 10) total = Math.round(t2 * 100) / 100;
    }
  }
  return { numero, sequence, mois, annee, fournisseur, date, total };
}
