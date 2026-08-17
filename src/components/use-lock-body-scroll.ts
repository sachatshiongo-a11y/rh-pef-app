"use client";

import { useEffect } from "react";

/**
 * Bloque le scroll de la page (body) tant qu'une modale plein écran est ouverte, puis le relâche
 * proprement à la fermeture — y compris si le composant est démonté sans repasser par `actif=false`
 * (ex. navigation). Sans ce verrou, sur mobile/PWA (iOS notamment), le fond peut continuer à défiler
 * sous une modale `fixed`, ce qui piège le doigt entre deux zones scrollables et « gèle » l'écran.
 */
export function useLockBodyScroll(actif: boolean) {
  useEffect(() => {
    if (!actif) return;
    const precedent = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = precedent;
    };
  }, [actif]);
}
