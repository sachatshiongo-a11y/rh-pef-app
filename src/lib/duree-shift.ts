// Durée d'un shift — module PUR (ni base, ni `server-only`). Déplacé de
// src/app/(app)/planning/creneaux.ts : la paie (src/lib/paie-reference-donnees.ts) en a besoin et
// `src/lib/` ne doit rien importer de `src/app/`. Même règle partout : planning, écart prévu/réalisé,
// pré-remplissage des heures et référence de paie — ce qui est posé au planning est ce qui est payé.

/** Durée d'un shift en heures : `dureeHeures` explicite, sinon calculée depuis les horaires (gère la nuit). */
export function dureeShift(s: { heureDebut: string | null; heureFin: string | null; dureeHeures: number | null }): number {
  if (s.dureeHeures != null) return s.dureeHeures;
  if (!s.heureDebut || !s.heureFin) return 0;
  const [hd, md] = s.heureDebut.split(":").map(Number);
  const [hf, mf] = s.heureFin.split(":").map(Number);
  let minutes = hf * 60 + mf - (hd * 60 + md);
  if (minutes < 0) minutes += 24 * 60; // shift de nuit (fin le lendemain)
  return Math.round((minutes / 60) * 100) / 100;
}
