import { SEUIL_TOLERANCE_PCT } from "@/lib/stock";

/**
 * Écart d'une ligne de comptage et verdict de tolérance, côté ÉCRAN : la même formule que `calculerLignes`
 * (src/lib/validations-stock/comptage.ts, réservé au serveur) — un test les compare sur une grille de cas.
 * Un écart au-delà de la tolérance (ou tout écart sur un théorique nul) exige une explication.
 */
export function ecartDeComptage(theorique: number, physique: number): { ecart: number; pct: number; horsTol: boolean } {
  const ecart = physique - theorique;
  const pct = theorique !== 0 ? (ecart / Math.abs(theorique)) * 100 : ecart !== 0 ? 100 : 0;
  const horsTol = Math.abs(ecart) > 0.0001 && (theorique === 0 ? physique !== 0 : Math.abs(pct) > SEUIL_TOLERANCE_PCT);
  return { ecart, pct, horsTol };
}
