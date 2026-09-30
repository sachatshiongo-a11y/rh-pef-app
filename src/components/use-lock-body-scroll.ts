"use client";

import { useEffect } from "react";

const PROPRIETES = ["position", "top", "left", "right", "width", "overflow"] as const;
type Styles = Record<(typeof PROPRIETES)[number], string>;

/**
 * Verrou du défilement de la PAGE, partagé par le tiroir des espaces et les modales plein écran.
 *
 * Pourquoi pas seulement `overflow: hidden` sur <body> : sur iOS (Safari et PWA installée) il ne
 * bloque PAS le défilement de la page — un geste sur un tiroir ou une modale `fixed` qui ne
 * déborde pas (ou qui arrive au bout) se « chaîne » à la page derrière, qui bouge sous le doigt.
 * La technique fiable : figer le body en `position: fixed` avec `top: -scrollY` (la page ne peut
 * plus défiler et reste visuellement à la même place), puis, à la fermeture, remettre les styles
 * d'avant et rejouer EXACTEMENT la position de défilement.
 *
 * Verrou COMPTÉ : deux appelants (le tiroir, puis une modale) peuvent se chevaucher ; la page n'est
 * relâchée que lorsque le dernier a fini, et la position restaurée est celle d'AVANT le premier.
 */
let verrous = 0;
let avant: { y: number; chemin: string; styles: Styles } | null = null;

/**
 * Verrouille la page ; renvoie la fonction qui relâche CE verrou (idempotente).
 * Si le chemin a changé entre le verrouillage et la libération (un lien du tiroir, la touche
 * retour), on ne rejoue PAS l'ancienne position : la nouvelle page décide où elle s'ouvre, et la
 * remettre à l'ancien scrollY l'ouvrirait décalée.
 */
export function verrouillerPage(): () => void {
  if (typeof document === "undefined") return () => {};
  const corps = document.body;
  if (verrous === 0) {
    const y = window.scrollY;
    avant = {
      y,
      chemin: window.location.pathname,
      styles: Object.fromEntries(PROPRIETES.map((p) => [p, corps.style[p]])) as Styles,
    };
    corps.style.position = "fixed";
    corps.style.top = `-${y}px`;
    corps.style.left = "0";
    corps.style.right = "0";
    corps.style.width = "100%";
    corps.style.overflow = "hidden";
  }
  verrous++;
  let libere = false;
  return () => {
    if (libere) return;
    libere = true;
    verrous = Math.max(0, verrous - 1);
    if (verrous > 0 || !avant) return;
    const { y, chemin, styles } = avant;
    avant = null;
    for (const p of PROPRIETES) corps.style[p] = styles[p];
    if (window.location.pathname === chemin) window.scrollTo({ top: y, left: 0, behavior: "instant" });
  };
}

/**
 * Bloque le scroll de la page (body) tant qu'une modale plein écran ou le tiroir est ouvert, puis le
 * relâche proprement à la fermeture — y compris si le composant est démonté sans repasser par
 * `actif=false` (ex. navigation). Voir `verrouillerPage` pour la technique.
 */
export function useLockBodyScroll(actif: boolean) {
  useEffect(() => {
    if (!actif) return;
    return verrouillerPage();
  }, [actif]);
}
