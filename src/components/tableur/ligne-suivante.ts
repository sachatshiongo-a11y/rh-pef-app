"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Formulaires à lignes (bon de commande, facture) : Entrée sur la dernière ligne ajoute une ligne
 * et place le curseur dans la même colonne de la nouvelle ligne, comme Excel.
 *
 * Convention : la `ligne` des cases est l'INDEX de la ligne (« 0 », « 1 »…). `racine` se pose sur
 * le <table> ; `onEntreeDerniereLigne` se passe à chaque `CelluleNombre` des lignes.
 */
export function useLigneSuivante(nbLignes: number, ajouter: () => void) {
  const racine = useRef<HTMLTableElement>(null);
  const colonneVisee = useRef<number | null>(null);

  // La nouvelle ligne n'existe qu'après le rendu : on la vise quand le nombre de lignes a changé.
  useEffect(() => {
    const col = colonneVisee.current;
    if (col === null) return;
    colonneVisee.current = null;
    const el = racine.current?.querySelector<HTMLInputElement>(`input[data-tableur-ligne="${nbLignes - 1}"][data-tableur-col="${col}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [nbLignes]);

  const onEntreeDerniereLigne = useCallback(({ col }: { ligne: string; col: number }) => {
    colonneVisee.current = col;
    ajouter();
  }, [ajouter]);

  return { racine, onEntreeDerniereLigne };
}
