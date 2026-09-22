"use client";

import { useEffect } from "react";

// Le service worker n'était enregistré que depuis l'écran des notifications (`push-toggle.tsx`) :
// la coquille n'aurait donc été mise en cache que pour les personnes qui les avaient activées. Il
// porte maintenant aussi le cache et la page hors ligne, deux choses qui servent à tout le monde —
// c'est ce qui justifie de l'enregistrer tout seul, et rien d'autre ne change pour les
// notifications.
//
// MÊME FICHIER, MÊME NOM que l'enregistrement des notifications (`/sw.js`) : deux service workers
// sur la même portée se chassent l'un l'autre, et le second aurait arrêté les notifications des
// téléphones déjà installés. Un enregistrement répété du MÊME fichier est sans effet — le
// navigateur le reconnaît.
export function EnregistrerSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Après le chargement : l'enregistrement ne doit pas concurrencer le premier rendu.
    const poser = () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); };
    if (document.readyState === "complete") poser();
    else { window.addEventListener("load", poser, { once: true }); return () => window.removeEventListener("load", poser); }
  }, []);
  return null;
}
