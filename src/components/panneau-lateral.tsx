"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";

/**
 * Panneau latéral d'un formulaire (« Nouvelle demande de congé »…) : un volet à DROITE sur ordinateur et
 * en plein écran sur téléphone (sous `sm`), au lieu d'un bloc repliable qui pousse la liste. Même
 * mécanique que le tiroir des espaces (`tiroir-mobile.tsx`) : la page derrière est figée pendant
 * l'ouverture (`use-lock-body-scroll`, position rendue à la fermeture), le panneau est le SEUL conteneur
 * qui défile (`overscroll-contain`, hauteur `dvh`, marges de sécurité), Échap et un appui sur le voile
 * ferment. Ni flou ni `backdrop-filter` (il décroche sur un élément fixe en PWA iOS).
 * Rendu par un portail dans <body> : la coquille de l'app est `overflow-hidden`, et sur iOS/PWA un
 * `position: fixed` qui en descend peut être recadré à ses bornes (même piège que `bouton-signer.tsx`).
 */
export function PanneauLateral({ ouvert, onFermer, titre, children }: { ouvert: boolean; onFermer: () => void; titre: string; children: ReactNode }) {
  const idTitre = useId();
  useLockBodyScroll(ouvert);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => { if (e.key === "Escape") onFermer(); };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [ouvert, onFermer]);

  if (!ouvert || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div data-voile-panneau className="fixed inset-0 z-40 touch-none overscroll-contain bg-black/40" onClick={onFermer} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-panneau-lateral
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto overscroll-contain border-l bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))] shadow-2xl max-sm:h-dvh sm:max-w-md sm:p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={idTitre} className="text-base font-semibold">{titre}</h2>
          <button type="button" onClick={onFermer} className="inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
            Fermer ✕
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
