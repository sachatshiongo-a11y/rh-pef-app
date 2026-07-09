import "server-only";

// Extraction BEST-EFFORT d'une facture fournisseur PDF (formats variés) : total et date.
// Toujours à faire confirmer par l'utilisateur — le PDF joint reste la source de vérité.

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type FournisseurExtrait = {
  nom: string | null; rccm: string | null; idNational: string | null;
  telephone: string | null; email: string | null; adresse: string | null; ville: string | null;
};
export type FactureExtrait = { montant: number | null; date: string | null; numero: string | null; fournisseur: FournisseurExtrait };

// Le document appartient à l'acheteur (Pâtes en Folie / TOLYA) : on écarte ces lignes.
const EST_ACHETEUR = (l: string) => /pate\s*en\s*folie|pates\s*en\s*folie|tolya/i.test(strip(l));
const FORME_JURIDIQUE = /\b(s\.?a\.?r\.?l|sarl|s\.?p\.?r\.?l|sprl|s\.?a\b|\bsa\b|ets\.?|établissements?|etablissements?|ste\.?|société|societe|company|trading|import|export)\b/i;

/** Extraction best-effort de l'en-tête fournisseur (nom + coordonnées). */
function extraireFournisseur(t: string): FournisseurExtrait {
  const lignes = t.split(/\r?\n/).map((l) => l.replace(/\t+/g, " ").trim()).filter(Boolean);
  const cap = (re: RegExp): string | null => {
    const m = t.match(re);
    return m ? m[1].replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "") || null : null;
  };
  // Nom : 1re ligne « entreprise » du haut du document (forme juridique ou majuscules), hors acheteur.
  let nom: string | null = null;
  for (const l of lignes.slice(0, 14)) {
    if (EST_ACHETEUR(l) || /facture|invoice|devis|bon de/i.test(l)) continue;
    const lettres = l.replace(/[^A-Za-zÀ-ÿ]/g, "");
    if (lettres.length < 3) continue;
    const majuscule = l === l.toUpperCase() && /[A-ZÀ-Ý]{3,}/.test(l);
    if (FORME_JURIDIQUE.test(l) || majuscule) { nom = l.replace(/\s{2,}/g, " ").replace(/[|•]/g, "").trim().slice(0, 80); break; }
  }
  // Label explicite éventuel (prioritaire).
  const parLabel = cap(/(?:Fournisseur|Vendeur|Seller|Supplier)\s*:?\s*([^\n]{2,60})/i);
  if (parLabel && !EST_ACHETEUR(parLabel)) nom = parLabel;

  const rccm = cap(/RCCM\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\/.\- ]{3,26})/i);
  const idNational = cap(/(?:ID\s*Nat(?:ional)?|IDNAT|N[°.\s]*IMPORT|N\.?\s*IMPORT|Id\.?\s*Nat)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\/.\- ]{3,26})/i);
  const telephone = cap(/(?:T[ée]l(?:[ée]phone)?|Tel|Phone|GSM|Mobile)\s*[:.]?\s*(\+?[0-9][0-9 ()\/.\-]{6,20})/i);
  const email = cap(/([A-Za-z0-9._%\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/);
  const adresse = cap(/((?:N[°o]?\s*\d+[, ]*)?(?:Av\.?|Avenue|Rue|Blvd|Boulevard|No\.?|Q\.|Quartier|Commune)[^\n]{3,60})/i);
  const villeM = t.match(/\b(Kinshasa|Lubumbashi|Goma|Matadi|Kolwezi|Bukavu|Kananga|Mbuji-?Mayi|Kikwit|Boma)\b/i);
  const ville = villeM ? villeM[1] : null;

  return { nom, rccm, idNational, telephone, email, adresse, ville };
}

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

  return { montant, date, numero, fournisseur: extraireFournisseur(t) };
}
