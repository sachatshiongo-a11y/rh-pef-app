// Passerelle entre les textes de ligne des écrans Stock (tableurs de saisie) et la règle de lecture
// à la française (virgule = décimale, point/espace = milliers — cf. `lireSaisieNombre`).
//
// Piège (2026-10-01) : une valeur que le PROGRAMME écrit dans une case (« 2.125 » d'un Decimal de la
// base, `String(2.5)`) n'est plus relue comme un nombre — « 2.5 » est illisible, « 2.125 » vaut 2125.
// Tout texte de ligne est donc écrit en notation française par `canoniqueVersSaisie`, relu par
// `nombreOuNull` / `nombreDeSaisie`, et envoyé tel quel au serveur (`decSaisi`).
import { ecrireSaisieNombre, lireNombreSaisi } from "@/lib/nombre";

/** Texte de la base (« 2.125 », notation anglaise d'un Decimal) ou nombre → texte de saisie (« 2,125 »). Vide → « ». */
export function canoniqueVersSaisie(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const t = String(v).trim();
  if (t === "") return "";
  const n = Number(t);
  return Number.isFinite(n) ? ecrireSaisieNombre(n) : t;
}

/** Texte de saisie → nombre, ou 0 si vide ou illisible : pour des totaux AFFICHÉS (la case, elle, signale l'illisible). */
export const nombreDeSaisie = (s: string | null | undefined): number => lireNombreSaisi(s ?? "") ?? 0;

/**
 * Valeur de la BASE (texte canonique d'un Decimal ou d'un nombre : « 2.125 »), pour pré-remplir une
 * case de tableur : null si vide. Jamais `lireSaisieNombre` ici — « 2.125 » y vaudrait 2125.
 */
export function nombreDeBase(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
