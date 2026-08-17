// Libellé en clair du code du jour (Attendance.code), partagé par l'écran d'écart
// (ecart-view.tsx) et son export Excel (excel/ecart/route.ts) — un seul dictionnaire, pour que les
// deux ne divergent jamais au premier ajout de code.

/** Le code du jour → sa raison en clair, jamais présentée comme une négligence du salarié
 *  (décision 2 de la conception) : ce libellé n'apparaît que pour un code réellement saisi. */
export const RAISON_CODE: Record<string, string> = {
  M: "maladie",
  A: "absence justifiée",
  N: "absence injustifiée",
  C: "congé",
  S: "sans solde",
  O: "repos",
  F: "férié",
};

export function raisonDe(code: string | null): string {
  return code == null ? "non renseigné" : (RAISON_CODE[code] ?? code);
}
