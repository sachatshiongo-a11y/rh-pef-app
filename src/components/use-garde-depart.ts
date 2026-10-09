"use client";

import { useEffect } from "react";

/**
 * GARDE DE DÉPART d'un écran où l'on a tapé quelque chose qui n'est pas encore enregistré.
 *
 * Tant que `actif` est vrai :
 *  - fermer ou recharger l'onglet est retenu par le navigateur (`beforeunload`) ;
 *  - un clic sur un lien INTERNE (menu, nom d'un article…) demande confirmation, et reste sur l'écran si on refuse.
 *    `beforeunload` ne voit jamais ces navigations-là (le routeur ne recharge pas la page), d'où l'écoute des clics,
 *    en phase de capture pour passer avant le routeur. Un lien qui ne quitte pas l'écran est laissé libre :
 *    téléchargement (`download`, ou `data-telechargement` posé par `TelechargerLien`), ancre `#…`, nouvel onglet,
 *    clic avec Ctrl/Cmd/Maj/Alt, adresse hors http(s).
 * Ne couvre PAS le bouton « retour » du navigateur ni un `router.push` : on ne prétend pas le contraire.
 */
export function useGardeDepart(actif: boolean, message: string) {
  useEffect(() => {
    if (!actif) return;
    const retenir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const clic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || a.hasAttribute("data-telechargement")) return;
      if (a.target && a.target !== "_self") return;
      if ((a.getAttribute("href") ?? "").startsWith("#")) return;
      let u: URL;
      try { u = new URL(a.href, window.location.href); } catch { return; }
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", retenir);
    document.addEventListener("click", clic, true);
    return () => {
      window.removeEventListener("beforeunload", retenir);
      document.removeEventListener("click", clic, true);
    };
  }, [actif, message]);
}
