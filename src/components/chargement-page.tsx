/**
 * Écran d'attente d'un changement de page (loading.tsx de chaque espace) : sobre, sans chiffre ni
 * nom — un titre et quelques lignes qui respirent, pour que le clic soit vu comme pris en compte
 * (sans lui, la page restait figée jusqu'à la réponse du serveur, et on cliquait deux fois).
 */
export function ChargementPage() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4 py-2">
      <span className="sr-only">Chargement…</span>
      <div className="h-7 w-48 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      <div className="space-y-2" aria-hidden="true">
        <div className="h-10 animate-pulse rounded-md bg-muted/70" />
        <div className="h-10 animate-pulse rounded-md bg-muted/70" />
        <div className="h-10 animate-pulse rounded-md bg-muted/70" />
      </div>
    </div>
  );
}
