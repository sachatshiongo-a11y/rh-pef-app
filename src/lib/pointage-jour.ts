// Le JOUR et les HEURES du pointage — fonctions pures, partagées entre le scan QR et les actions
// existantes (`pointer-actions.ts`). Ne pas confondre avec `heure-kinshasa.ts` : `jourKinshasa()`
// là-bas RENVOIE UNE CHAÎNE d'affichage (« JJ/MM/AAAA ») ; ici `dateDuJourKinshasa` renvoie une
// vraie DATE (minuit UTC du jour de Kinshasa), la forme stockée en base pour `Pointage.date`.

/** Jour courant en heure de Kinshasa (UTC+1, sans changement d'heure) → DATE à minuit UTC. */
export function dateDuJourKinshasa(d: Date = new Date()): Date {
  const k = new Date(d.getTime() + 3_600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}

/** Heures nettes payables = (départ − arrivée) − pause saisie par l'employé, jamais négatif. */
export function heuresNettes(debut: Date, fin: Date, pauseMinutes: number): number {
  const h = (fin.getTime() - debut.getTime()) / 3_600_000 - pauseMinutes / 60;
  return Math.max(0, Math.round(h * 100) / 100);
}
