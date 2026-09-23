// Les règles PURES du pointage par QR + position. AUCUNE dépendance Node ici : ce module est
// importé par le composant CLIENT qui scanne l'affiche (caméra, géolocalisation). Le code
// d'affiche (node:crypto) vit à part, dans `pointage-code.ts`, jamais importé côté client.

import { formaterNombre } from "@/lib/montant";

export type Coordonnees = { lat: number; lng: number };

export type PositionScan = { lat: number; lng: number; precisionM: number } | { erreur: "REFUSEE" | "INDISPONIBLE" };

export type MotifVerification = "LOIN" | "POSITION_REFUSEE" | "POSITION_INDISPONIBLE" | "PRECISION_INSUFFISANTE";

export type VerdictPosition =
  | { verdict: "AU_RESTAURANT"; distanceM: number }
  | { verdict: "A_VERIFIER"; motif: MotifVerification; distanceM: number | null; precisionM?: number }; // precisionM porté si PRECISION_INSUFFISANTE

/** Rayon toléré par défaut autour du restaurant, en mètres (réglage Direction). */
export const RAYON_DEFAUT_M = 150;
/** Précision GPS au-delà de laquelle le point n'a plus de sens. */
export const PRECISION_MAX_M = 300;
/** Précision maximale acceptée quand la Direction règle la position du restaurant. */
export const PRECISION_REGLAGE_MAX_M = 100;
/**
 * Refus d'imprimer l'affiche ou d'en changer le code tant que la position du restaurant n'est pas
 * réglée (sans elle, `enregistrerScan` refuse chaque scan). Ici, et pas côté serveur, pour que
 * l'écran des réglages dise EXACTEMENT la même chose que le refus.
 */
export const MESSAGE_POSITION_NON_REGLEE =
  "Réglez d'abord la position du restaurant : sans elle, chaque scan de l'affiche serait refusé.";
/** Un second scan avant ce délai après l'arrivée déclenche la confirmation « double scan ». */
export const DELAI_DOUBLE_SCAN_MS = 5 * 60_000;

/** Distance haversine entre deux points, en mètres. */
export function distanceMetres(a: Coordonnees, b: Coordonnees): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Le verdict d'un scan : erreur de géolocalisation → à vérifier ; précision au-delà du plafond →
 * à vérifier (le point n'a plus de sens) ; distance ≤ rayon + précision → au restaurant (le
 * cercle d'incertitude touche le restaurant, bénéfice du doute) ; sinon → à vérifier, loin.
 */
export function verdictPosition(p: PositionScan, restaurant: Coordonnees, rayonM: number): VerdictPosition {
  if ("erreur" in p) {
    return {
      verdict: "A_VERIFIER",
      motif: p.erreur === "REFUSEE" ? "POSITION_REFUSEE" : "POSITION_INDISPONIBLE",
      distanceM: null,
    };
  }
  const distanceM = distanceMetres(p, restaurant);
  if (p.precisionM > PRECISION_MAX_M) {
    return { verdict: "A_VERIFIER", motif: "PRECISION_INSUFFISANTE", distanceM, precisionM: p.precisionM };
  }
  if (distanceM <= rayonM + p.precisionM) {
    return { verdict: "AU_RESTAURANT", distanceM };
  }
  return { verdict: "A_VERIFIER", motif: "LOIN", distanceM };
}

/** L'URL affichée (imprimée) par l'affiche de pointage, pour une origine et un code donnés. */
export function urlAffiche(origine: string, code: string): string {
  return `${origine}/scan?c=${encodeURIComponent(code)}`;
}

/**
 * Relit le code d'une affiche depuis le contenu scanné. `null` si ce n'est pas notre affiche : une
 * origine hors de `origines` (cf. `originesAcceptees` dans `pointage-origines.ts`), un autre chemin.
 */
export function lireCodeDepuisQr(contenu: string, origines: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(contenu);
  } catch {
    return null;
  }
  if (!origines.includes(url.origin) || url.pathname !== "/scan") return null;
  return url.searchParams.get("c");
}

/** Lit des coordonnées collées depuis Google Maps (« -4.3217, 15.3125 »). `null` si illisible ou hors bornes. */
export function lireCoordonneesSaisies(texte: string): Coordonnees | null {
  const m = texte.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Libellé lisible du motif d'un verdict « à vérifier » (affiché au Suivi de la Direction). */
export function libelleMotif(v: VerdictPosition): string {
  if (v.verdict === "AU_RESTAURANT") return "au restaurant";
  if (v.motif === "POSITION_REFUSEE") return "position refusée";
  if (v.motif === "POSITION_INDISPONIBLE") return "position indisponible";
  if (v.motif === "PRECISION_INSUFFISANTE") return `précision ±${formaterNombre(v.precisionM ?? 0)} m`;
  // LOIN
  const d = v.distanceM ?? 0;
  return d >= 1000
    ? `à ${formaterNombre(d / 1000, { maximumFractionDigits: 1 })} km`
    : `à ${formaterNombre(Math.round(d))} m`;
}

/** Compteur de la semaine pour le Suivi : combien de scans restent « à vérifier », jamais NaN. */
export function resumeSemaine(scans: { verdict: "AU_RESTAURANT" | "A_VERIFIER" }[]): { total: number; aVerifier: number; pourcent: number } {
  const total = scans.length;
  const aVerifier = scans.filter((s) => s.verdict === "A_VERIFIER").length;
  const pourcent = total === 0 ? 0 : Math.round((aVerifier / total) * 100);
  return { total, aVerifier, pourcent };
}
