import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// Le JOUR et les HEURES du pointage — fonctions pures, utilisées par le scan QR (seul chemin de
// pointage) et par CHAQUE écran qui montre les heures d'un pointage. Ne pas confondre avec
// `jourKinshasa()` de `heure-kinshasa.ts`, qui RENVOIE UNE CHAÎNE d'affichage (« JJ/MM/AAAA ») ;
// ici `dateDuJourKinshasa` renvoie une vraie DATE (minuit UTC du jour de Kinshasa), la forme
// stockée en base pour `Pointage.date`.
//
// Module sans dépendance serveur : l'écran « Pointer » et le scanner (composants CLIENT) le lisent.

/**
 * Jour courant en heure de Kinshasa → DATE à minuit UTC. Simple renvoi vers `jourCivilKinshasa` :
 * `heure-kinshasa.ts` reste le SEUL endroit qui convertit un instant en jour de Kinshasa.
 */
export function dateDuJourKinshasa(d: Date = new Date()): Date {
  return jourCivilKinshasa(d);
}

// ── La pause et les heures payables — décision d'argent de la Direction du 2026-09-29 ──────────
//
// « La paie ne doit pas être affectée. » La pause PAR DÉFAUT (30 min, posée d'office au départ
// scanné sans pause saisie) s'AFFICHE mais n'est JAMAIS déduite : heures payées = départ − arrivée.
// Seule une pause SAISIE par le salarié se déduit.
//
// Forme de stockage (la plus sûre) : `Pointage.pauseMinutes` = les minutes DÉDUITES, donc 0 pour
// la pause par défaut, qui n'est portée que par `pauseParDefaut = true` (l'affichage lit
// `PAUSE_PAR_DEFAUT_MIN`, cf. `libellePause`). Un lecteur qui calculerait « départ − arrivée −
// pauseMinutes » sans lire le drapeau tomberait donc JUSTE quand même. Et `heuresPayables` ignore
// de toute façon `pauseMinutes` quand le drapeau est levé (une ligne ancienne à 30 + vrai reste
// payée sans déduction). Garde-fou : `pointage-heures.garde-fou.test.ts` — aucun autre fichier ne
// soustrait `pauseMinutes`.

/** Ce qu'un pointage porte de sa pause. */
export type PausePointage = { pauseMinutes: number; pauseParDefaut: boolean };

/**
 * La pause d'une journée pointée, telle que l'écran la reçoit : `parDefaut` = posée d'office
 * (affichée « pause par défaut 30 min (non déduite) ») ; `minutesDeduites` = ce qui est RETIRÉ des
 * heures payées — toujours 0 pour la pause par défaut.
 */
export type PauseDuJour = { parDefaut: boolean; minutesDeduites: number };

/** Les minutes de pause RETIRÉES des heures payées : 0 pour la pause par défaut, jamais négatif. */
export function pauseDeduiteMinutes(p: PausePointage): number {
  if (p.pauseParDefaut) return 0;
  return Math.max(0, Number(p.pauseMinutes) || 0);
}

export function pauseDuJour(p: PausePointage): PauseDuJour {
  return { parDefaut: p.pauseParDefaut, minutesDeduites: pauseDeduiteMinutes(p) };
}

/**
 * LES heures payables d'un pointage clos — la SEULE fonction du dépôt qui retire une pause des
 * heures d'un pointage : (départ − arrivée) − pause SAISIE ; la pause par défaut n'est pas déduite.
 * Jamais négatif, arrondi au centième. C'est ce nombre qui est écrit dans `OvertimeEntry`
 * (Présences & heures → paie), et que « Pointer », le Suivi et le scan affichent.
 */
export function heuresPayables(p: PausePointage & { heureDebut: Date; heureFin: Date }): number {
  const h = (p.heureFin.getTime() - p.heureDebut.getTime()) / 3_600_000 - pauseDeduiteMinutes(p) / 60;
  return Math.max(0, Math.round(h * 100) / 100);
}
