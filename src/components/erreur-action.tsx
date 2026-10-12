/**
 * Refus ou échec d'une action, affiché là où la personne regarde (bandeau rouge des écrans de liste).
 * Rien ne s'affiche tant que `message` est vide ; `role="alert"` : les lecteurs d'écran l'annoncent.
 *
 * `emplacement` (formulaires) : le MÊME refus s'affiche en haut ET en bas du formulaire (un long formulaire
 * se refuse près du bouton d'envoi, mais se corrige depuis le haut). Un seul des deux porte `role="alert"`
 * (« haut ») ; « bas » est masqué aux lecteurs d'écran pour ne pas doubler la lecture. `data-refus` :
 * repère de `useRefusVisible` (components/refus-visible.ts), qui ramène l'un des deux à l'écran.
 */
export function ErreurAction({ message, className = "", emplacement }: { message: string | null | undefined; className?: string; emplacement?: "haut" | "bas" }) {
  if (!message) return null;
  return (
    <p
      role={emplacement === "bas" ? undefined : "alert"}
      aria-hidden={emplacement === "bas" ? true : undefined}
      data-refus={emplacement}
      className={`rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive ${className}`.trim()}
    >
      {message}
    </p>
  );
}
