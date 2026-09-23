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

/**
 * Les coordonnées du restaurant AU FORMAT DE SAISIE (« -4.3217, 15.3125 » : point décimal, virgule
 * entre les deux) — pour qu'on puisse les recopier telles quelles dans le champ, que relit
 * `lireCoordonneesSaisies`. Jamais la virgule décimale française (« -4,3217 ») : elle ne se relit pas.
 * Six décimales au plus (colonnes Decimal(9, 6)), zéros de fin retirés.
 */
export function coordonneesSaisissables(lat: number, lng: number): string {
  const f = (x: number) => x.toFixed(6).replace(/\.?0+$/, "");
  return `${f(lat)}, ${f(lng)}`;
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

/**
 * Le scan d'un moment donné (arrivée/départ) encore « à vérifier » — un scan A_VERIFIER SANS
 * `verifieLe`. C'est cette fonction, et elle seule, qui décide si le badge « À vérifier » du
 * Suivi s'affiche pour ce moment : un scan A_VERIFIER déjà vérifié, ou un scan AU_RESTAURANT, ne
 * doit plus jamais ressortir. `undefined` si aucun scan de ce moment n'attend d'être vérifié.
 */
export function scanAVerifier<S extends { moment: "ARRIVEE" | "DEPART"; verdict: "AU_RESTAURANT" | "A_VERIFIER"; verifieLe?: unknown }>(
  scans: S[],
  moment: "ARRIVEE" | "DEPART",
): S | undefined {
  return scans.find((s) => s.moment === moment && s.verdict === "A_VERIFIER" && !s.verifieLe);
}

/**
 * Compteur de la semaine pour le Suivi : parmi les POINTAGES de la semaine ayant au moins un scan
 * (chacun compte pour UN, jamais pour ses deux scans arrivée+départ), combien n'ont PAS confirmé
 * la présence au restaurant — au moins un de leurs scans est A_VERIFIER, indépendamment de
 * `verifieLe` (c'est une mesure de la fiabilité de la position, pas du travail de vérification
 * restant à faire). Un pointage sans aucun scan (source MANUEL/APP) n'entre ni au numérateur ni au
 * dénominateur : `resumeSemaineCourante` ne lui donne même pas de ligne. Jamais NaN.
 */
export function resumePointagesSemaine(
  pointages: { verdicts: ("AU_RESTAURANT" | "A_VERIFIER")[] }[]
): { total: number; horsRestaurant: number; pourcent: number } {
  const total = pointages.length;
  const horsRestaurant = pointages.filter((p) => p.verdicts.includes("A_VERIFIER")).length;
  const pourcent = total === 0 ? 0 : Math.round((horsRestaurant / total) * 100);
  return { total, horsRestaurant, pourcent };
}
