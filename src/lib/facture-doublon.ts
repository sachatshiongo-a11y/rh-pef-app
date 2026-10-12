import { cleAlnum } from "@/lib/texte";

// FACTURE SAISIE DEUX FOIS (audit du 10/10/2026, constat 6). Rien n'empêchait d'enregistrer deux fois la
// même facture : double dette, double entrée en stock. Règles, partagées par la saisie, la lecture d'un
// PDF et l'import (module PUR) :
//  - MÊME fournisseur et MÊME numéro  -> refus sec (une facture a un numéro unique chez son fournisseur) ;
//  - MÊME fournisseur, MÊME montant (dans la même devise) à ±14 jours -> avertissement « Créer quand
//    même » (deux livraisons identiques à une semaine d'écart existent : l'outil signale, la Direction tranche).

/** Fenêtre (en jours) de la comparaison « même montant ». */
export const JOURS_DOUBLON_FACTURE = 14;

export type FactureComparable = {
  fournisseurId: string | null; fournisseurNom: string; numero: string | null;
  /** Jour de la facture (`AAAA-MM-JJ`) ; absent -> comparé au mois (annee, mois). */
  date: string | null; annee: number; mois: number;
  devise: "USD" | "CDF"; montant: number;
};
export type FactureExistante = FactureComparable & { id: string };

export type DoublonFacture =
  | { type: "MEME_NUMERO"; facture: FactureExistante }
  | { type: "PROCHE"; factures: FactureExistante[] };

/** Numéro comparé sans casse, sans espaces ni ponctuation (« FA-001 » = « fa 001 »). Vide = pas de numéro. */
export const cleNumeroFacture = (n: string | null | undefined): string => cleAlnum(n ?? "");

/** Deux factures du même fournisseur : même identifiant connu des deux côtés, sinon même nom (casse, accents, espaces). */
export function memeFournisseurFacture(a: Pick<FactureComparable, "fournisseurId" | "fournisseurNom">, b: Pick<FactureComparable, "fournisseurId" | "fournisseurNom">): boolean {
  if (a.fournisseurId && b.fournisseurId) return a.fournisseurId === b.fournisseurId;
  const ka = cleAlnum(a.fournisseurNom);
  return !!ka && ka === cleAlnum(b.fournisseurNom);
}

const JOUR_MS = 86_400_000;
const ecartJours = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / JOUR_MS;

/** Même période : à ±14 jours si les deux dates sont connues, sinon le même mois. */
function periodeProche(a: FactureComparable, b: FactureComparable): boolean {
  if (a.date && b.date) return ecartJours(a.date, b.date) <= JOURS_DOUBLON_FACTURE;
  return a.annee === b.annee && a.mois === b.mois;
}

/**
 * Cherche une facture déjà saisie qui ressemble à la nouvelle. `existantes` : les factures à comparer (la
 * recherche en base ne rapatrie que celles du fournisseur). Le même numéro l'emporte sur le même montant.
 */
export function chercherDoublonFacture(nouvelle: FactureComparable, existantes: readonly FactureExistante[]): DoublonFacture | null {
  const memes = existantes.filter((e) => memeFournisseurFacture(nouvelle, e));
  const k = cleNumeroFacture(nouvelle.numero);
  if (k) {
    const meme = memes.find((e) => cleNumeroFacture(e.numero) === k);
    if (meme) return { type: "MEME_NUMERO", facture: meme };
  }
  const proches = memes.filter((e) => e.devise === nouvelle.devise && Math.abs(e.montant - nouvelle.montant) < 0.005 && periodeProche(nouvelle, e));
  return proches.length > 0 ? { type: "PROCHE", factures: proches.slice(0, 5) } : null;
}

const jjmmaaaa = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "sans date");

/** Phrase lisible d'un doublon (écran de saisie, aperçu d'import). `montantTexte` : le montant formaté dans sa devise. */
export function messageDoublonFacture(d: DoublonFacture, montantTexte: (devise: "USD" | "CDF", montant: number) => string): string {
  if (d.type === "MEME_NUMERO") {
    const f = d.facture;
    return `Ce fournisseur a déjà une facture n° ${f.numero} (${montantTexte(f.devise, f.montant)}, ${jjmmaaaa(f.date)}) : un numéro de facture est unique chez un fournisseur. Rien n'a été enregistré.`;
  }
  const liste = d.factures.map((f) => `${f.numero ? `n° ${f.numero}` : "sans n°"} du ${jjmmaaaa(f.date)}`).join(", ");
  const f0 = d.factures[0];
  return `Une facture du même fournisseur, du même montant (${montantTexte(f0.devise, f0.montant)}) et datée à ${JOURS_DOUBLON_FACTURE} jours près existe déjà (${liste}) : cette facture est peut-être déjà saisie.`;
}
