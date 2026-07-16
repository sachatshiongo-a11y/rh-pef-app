"use client";

import { useState } from "react";
import { TelechargerLien } from "@/components/telecharger-lien";

/** Bouton ouvrant le contrat PDF en plein écran, avec bouton de fermeture (évite de rester « coincé »).
 *  `href` = route du PDF (Direction : /employes/{id}/contrat/{contratId} ; espace : /espace/contrat/{id}). */
export function ContratViewerButton({ href, titre, libelle = "Voir le contrat", className = "font-medium text-primary underline" }: { href: string; titre: string; libelle?: string; className?: string }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <>
      <button onClick={() => setOuvert(true)} className={className}>
        {libelle}
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4" onClick={() => setOuvert(false)}>
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-lg bg-card px-4 py-2">
              <span className="truncate text-sm font-semibold">{titre}</span>
              <div className="flex shrink-0 items-center gap-2">
                <TelechargerLien href={`${href}?dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                  Télécharger
                </TelechargerLien>
                <button onClick={() => setOuvert(false)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                  Fermer ✕
                </button>
              </div>
            </div>
            <iframe key={href} src={href} title={titre} className="w-full flex-1 rounded-b-lg bg-white" />
          </div>
        </div>
      )}
    </>
  );
}
