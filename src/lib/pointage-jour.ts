import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// Le JOUR et les HEURES du pointage — fonctions pures, utilisées par le scan QR (seul chemin de
// pointage). Ne pas confondre avec `jourKinshasa()` de `heure-kinshasa.ts`, qui RENVOIE UNE CHAÎNE
// d'affichage (« JJ/MM/AAAA ») ; ici `dateDuJourKinshasa` renvoie une vraie DATE (minuit UTC du jour
// de Kinshasa), la forme stockée en base pour `Pointage.date`.

/**
 * Jour courant en heure de Kinshasa → DATE à minuit UTC. Simple renvoi vers `jourCivilKinshasa` :
 * `heure-kinshasa.ts` reste le SEUL endroit qui convertit un instant en jour de Kinshasa.
 */
export function dateDuJourKinshasa(d: Date = new Date()): Date {
  return jourCivilKinshasa(d);
}

/** Heures nettes payables = (départ − arrivée) − pause saisie par l'employé, jamais négatif. */
export function heuresNettes(debut: Date, fin: Date, pauseMinutes: number): number {
  const h = (fin.getTime() - debut.getTime()) / 3_600_000 - pauseMinutes / 60;
  return Math.max(0, Math.round(h * 100) / 100);
}
