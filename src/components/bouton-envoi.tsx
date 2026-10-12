"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { useEnvoiEnCours } from "@/components/formulaire-garde";

/**
 * Bouton d'envoi qui ATTEND la réponse du serveur : désactivé et libellé « Envoi… » tant que le
 * formulaire part, pour qu'un second clic (4G lente) ne crée pas un doublon — frais médical avec
 * certificat, prime, avantage, acompte, document, contrat, nouvel employé (audit du 10/10/2026,
 * ergonomie 5). Fonctionne dans un `<form action={…}>` (useFormStatus) comme dans un
 * FormulaireGarde (contexte partagé). Les classes sont celles du bouton qu'il remplace.
 */
export function BoutonEnvoi({
  children,
  enCours = "Envoi…",
  disabled,
  ...reste
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { enCours?: string }) {
  const { pending } = useFormStatus();
  const garde = useEnvoiEnCours();
  const attente = pending || garde;
  return (
    <button {...reste} type="submit" disabled={disabled || attente} aria-busy={attente || undefined}>
      {attente ? enCours : children}
    </button>
  );
}
