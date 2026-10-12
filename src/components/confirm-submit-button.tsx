"use client";

import { BoutonApprouver, BoutonNeutre, BoutonRefuser } from "@/components/action-buttons";

/**
 * Bouton de formulaire qui demande une confirmation navigateur avant de soumettre.
 *
 * Deux usages :
 * - avec `variante` : le bouton VIENT de la famille action-buttons.tsx (couleur, forme et
 *   icône dans le composant). C'est le seul chemin autorisé pour une décision — sans lui,
 *   n'importe qui pouvait peindre un « Clôturer la paie » vert à la main en passant une
 *   className à travers cette enveloppe, sans jamais faire rougir le garde-fou de source.
 * - sans `variante` : comportement historique, la className de l'appelant est posée telle
 *   quelle sur le <button>. Réservé aux suppressions/ruptures en contour destructif, qui
 *   sont une autre famille.
 */

const VARIANTES = {
  approuver: BoutonApprouver,
  refuser: BoutonRefuser,
  neutre: BoutonNeutre,
} as const;

export function ConfirmSubmitButton({
  message,
  className,
  children,
  variante,
  title,
  "aria-label": ariaLabel,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
  variante?: keyof typeof VARIANTES;
  /** Info-bulle et nom accessible d'un bouton-icône (✕) : sans eux, un lecteur d'écran lit « croix ». */
  title?: string;
  "aria-label"?: string;
}) {
  const confirmer = (ev: React.MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(message)) {
      ev.preventDefault();
    }
  };

  if (variante) {
    const Bouton = VARIANTES[variante];
    return (
      <Bouton type="submit" className={className} onClick={confirmer} title={title} aria-label={ariaLabel}>
        {children}
      </Bouton>
    );
  }

  return (
    <button type="submit" className={className} onClick={confirmer} title={title} aria-label={ariaLabel}>
      {children}
    </button>
  );
}
