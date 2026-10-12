/**
 * Refus ou échec d'une action, affiché là où la personne regarde (bandeau rouge des écrans de liste).
 * Rien ne s'affiche tant que `message` est vide ; `role="alert"` : les lecteurs d'écran l'annoncent.
 */
export function ErreurAction({ message, className = "" }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={`rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive ${className}`.trim()}>
      {message}
    </p>
  );
}
