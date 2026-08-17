"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { TelechargerLien } from "@/components/telecharger-lien";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";
import type { Devise } from "@/lib/pdf/theme";

/** Bouton « Aperçu » ouvrant le vrai bulletin PDF en plein écran (sans téléchargement), façon PayFit.
 *  `base` = route du PDF (Direction : /paie/bulletin ; espace salarié : /espace/bulletin). */
export function BulletinViewerButton({ payrollLineId, nom, base = "/paie/bulletin", libelle = "Aperçu" }: { payrollLineId: string; nom: string; base?: string; libelle?: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [devise, setDevise] = useState<Devise>("USD");
  const src = `${base}/${payrollLineId}?devise=${devise}`;
  useLockBodyScroll(ouvert);

  return (
    <>
      <button onClick={() => setOuvert(true)} className="font-medium text-primary underline">
        {libelle}
      </button>

      {/* Rendue via portail DANS <body>, hors de la coquille `overflow-hidden` de l'app (voir
          app-shell.tsx) : sur iOS Safari/PWA, un descendant `position: fixed` d'un ancêtre
          `overflow: hidden` peut être recadré aux bornes de cet ancêtre au lieu du viewport entier
          — d'où un aperçu réduit à « une petite case » et le doigt piégé entre deux zones
          scrollables (page figée). Le portail évite ce piège. */}
      {ouvert &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black/70 p-2 sm:p-4"
            onClick={() => setOuvert(false)}
          >
            <div
              className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-card px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">Bulletin — {nom}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border text-xs">
                    {(["USD", "CDF"] as Devise[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDevise(d)}
                        className={`px-2.5 py-1 ${devise === d ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                      >
                        {d === "USD" ? "$" : "CDF"}
                      </button>
                    ))}
                  </div>
                  {/* Repli visible : sur iOS, l'aperçu PDF en iframe se comporte parfois mal
                      (rendu partiel, scroll capturé). Un onglet séparé utilise le vrai lecteur PDF
                      du système, toujours fiable. */}
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    Nouvel onglet
                  </a>
                  <TelechargerLien href={`${src}&dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Télécharger
                  </TelechargerLien>
                  <button onClick={() => setOuvert(false)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
                    Fermer ✕
                  </button>
                </div>
              </div>
              <iframe key={src} src={src} title={`Bulletin ${nom}`} className="h-full min-h-0 w-full flex-1 rounded-b-lg bg-white" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
