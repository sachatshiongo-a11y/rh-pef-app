import "server-only";

// Extraction BEST-EFFORT d'une facture fournisseur PDF (formats variés) : total et date.
// Toujours à faire confirmer par l'utilisateur — le PDF joint reste la source de vérité.

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type FactureExtrait = { montant: number | null; date: string | null; numero: string | null };

export async function extraireFacturePDF(buffer: ArrayBuffer, tauxCDF: number): Promise<FactureExtrait> {
  const mod = (await import("pdf-parse")) as unknown as { PDFParse: new (o: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> } };
  const { text } = await new mod.PDFParse({ data: new Uint8Array(buffer) }).getText();
  const t = text;
  const nt = strip(t);

  // Date : première date jj/mm/aaaa, jj-mm-aaaa ou aaaa-mm-jj rencontrée.
  let date: string | null = null;
  const dm = t.match(/\b([0-3]?\d)[/.\-]([01]?\d)[/.\-](\d{4}|\d{2})\b/) || t.match(/\b(\d{4})-([01]?\d)-([0-3]?\d)\b/);
  if (dm) {
    if (dm[1].length === 4) date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
    else { const yy = dm[3].length === 4 ? dm[3] : "20" + dm[3]; date = `${yy}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`; }
  }

  // Numéro : « facture n° X » / « invoice X ».
  let numero: string | null = null;
  const nm = t.match(/(?:facture|invoice)\s*(?:n[°o]?|#|no\.?)?\s*[:.]?\s*([A-Za-z0-9/\-]{2,20})/i);
  if (nm && !/^\d{1,2}$/.test(nm[1])) numero = nm[1];

  // Montant : on cherche un montant après un mot-clé de total ; sinon le plus grand montant.
  const nombres = [...t.matchAll(/([0-9][0-9.,\s]{1,15})/g)]
    .map((m) => Number(m[1].replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
  let montant: number | null = null;
  const kw = ["net a payer", "total ttc", "montant total", "total a payer", "a payer", "total", "montant"];
  for (const k of kw) {
    const idx = nt.indexOf(k);
    if (idx >= 0) {
      const apres = t.slice(idx, idx + 60);
      const a = apres.match(/([0-9][0-9.,\s]{1,15})/);
      if (a) { const v = Number(a[1].replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".")); if (Number.isFinite(v) && v > 0) { montant = v; break; } }
    }
  }
  if (montant == null && nombres.length) montant = Math.max(...nombres);

  // Devise : si le document est libellé en francs (FC/CDF) sans « $ », on convertit en USD.
  if (montant != null) {
    const enCDF = (/\bfc\b|cdf|franc/.test(nt)) && !/\$|usd|dollar/.test(nt);
    if (enCDF && tauxCDF > 0) montant = montant / tauxCDF;
    else if (montant >= 10000 && tauxCDF > 0) montant = montant / tauxCDF; // sécurité : montant énorme = francs
    montant = Math.round(montant * 100) / 100;
  }

  return { montant, date, numero };
}
