"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { TelechargerLien } from "@/components/telecharger-lien";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";

/** Bouton ouvrant un PDF (contrat / attestation de paie) en plein écran, avec bouton de fermeture.
 *  `href` = route du PDF (ex. /employes/{id}/contrat/{contratId}, /employes/{id}/attestation-paie/{ligneId}). */
export function ContratViewerButton({ href, titre, libelle = "Voir le contrat", className = "font-medium text-primary underline" }: { href: string; titre: string; libelle?: string; className?: string }) {
  const [ouvert, setOuvert] = useState(false);
  useLockBodyScroll(ouvert);

  return (
    <>
      <button onClick={() => setOuvert(true)} className={className}>
        {libelle}
      </button>

      {/* Portail DANS <body> + verrou de scroll : même correctif que BulletinViewerButton — sur iOS
          Safari/PWA, une modale `fixed` descendante d'un ancêtre `overflow-hidden` (la coquille de
          l'app) est recadrée à une « petite case » et fige la page. Le portail évite ce piège. */}
      {ouvert &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black/70 p-2 sm:p-4" onClick={() => setOuvert(false)}>
            <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-card px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{titre}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Nouvel onglet
                  </a>
                  <TelechargerLien href={`${href}?dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Télécharger
                  </TelechargerLien>
                  <button onClick={() => setOuvert(false)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                    Fermer ✕
                  </button>
                </div>
              </div>
              <iframe key={href} src={href} title={titre} className="h-full min-h-0 w-full flex-1 rounded-b-lg bg-white" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
