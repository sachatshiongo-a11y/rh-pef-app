// Source unique des boutons d'action de validation (B7 / D, uniformisation 2026-09-22).
// Avant : la même décision (approuver/refuser une demande) était peinte de six façons
// différentes selon l'écran — aplat, pastille, contour, couleurs en dur. Ici, l'icône et
// la forme sont DANS le composant : un écran ne peut plus les faire dériver.
// Vert = approuver/valider, rouge = refuser (toujours un APLAT, jamais un contour — à
// côté d'un aplat vert, un contour se lit comme secondaire alors que les deux décisions
// ont le même poids). rounded-md et non rounded-full : c'est la forme de tous les autres
// boutons du logiciel, la cohérence d'ensemble prime sur celle d'un écran.
//
// Pas de "use client" ici : ces composants n'ont ni state ni hook, ils héritent du
// contexte de leur appelant (serveur avec <form action={...}> + type="submit", ou client
// avec onClick + useTransition).
import type { ButtonHTMLAttributes } from "react";

const BASE_CLASSES =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50";

type BoutonActionProps = ButtonHTMLAttributes<HTMLButtonElement>;

function fusionner(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** Bouton d'approbation — aplat vert (bg-success), icône ✓, libellé « Approuver » par défaut. */
export function BoutonApprouver({ children, className, ...props }: BoutonActionProps) {
  return (
    <button
      {...props}
      className={fusionner(BASE_CLASSES, "bg-success text-white hover:bg-success/90", className)}
    >
      <span aria-hidden="true">✓</span>
      {children ?? "Approuver"}
    </button>
  );
}

/**
 * Bouton de refus — aplat rouge (bg-destructive), jamais un contour : le refus a le même
 * poids visuel que l'approbation. Icône ✕, libellé « Refuser » par défaut.
 */
export function BoutonRefuser({ children, className, ...props }: BoutonActionProps) {
  return (
    <button
      {...props}
      className={fusionner(BASE_CLASSES, "bg-destructive text-white hover:bg-destructive/90", className)}
    >
      <span aria-hidden="true">✕</span>
      {children ?? "Refuser"}
    </button>
  );
}

/**
 * Bouton de validation à sens unique (pas de « refus » en vis-à-vis) — même aplat vert que
 * BoutonApprouver, mais pour les écrans où l'action n'a pas d'opposé (valider un bon de
 * commande, valider/marquer payé un bulletin de paie...). Icône ✓, libellé « Valider » par défaut.
 */
export function BoutonValider({ children, className, ...props }: BoutonActionProps) {
  return (
    <button
      {...props}
      className={fusionner(BASE_CLASSES, "bg-success text-white hover:bg-success/90", className)}
    >
      <span aria-hidden="true">✓</span>
      {children ?? "Valider"}
    </button>
  );
}

/**
 * Bouton neutre — pour une étape intermédiaire qui n'est ni une approbation ni un refus
 * (ex. « Rouvrir » un bulletin déjà validé). Pas d'icône imposée : le libellé la porte au
 * besoin (« ↩ Rouvrir »).
 */
export function BoutonNeutre({ children, className, ...props }: BoutonActionProps) {
  return (
    <button {...props} className={fusionner(BASE_CLASSES, "border hover:bg-accent", className)}>
      {children}
    </button>
  );
}

// Chaîne de classes équivalente à BoutonNeutre, pour les rares cas où un <button> neutre
// doit rester un élément brut (ex. composition avec un <select> dans le même <form>, comme
// dans status-actions.tsx). À réserver aux étapes intermédiaires qui ne sont ni une
// approbation ni un refus — pour approuver/refuser/valider, toujours un composant ci-dessus.
export const BTN_NEUTRE =
  "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent";
