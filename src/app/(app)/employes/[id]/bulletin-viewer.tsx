"use client";

import { useState } from "react";
import type { Devise } from "@/lib/pdf/theme";

/** Bouton « Aperçu » ouvrant le vrai bulletin PDF en plein écran (sans téléchargement), façon PayFit. */
export function BulletinViewerButton({ payrollLineId, nom }: { payrollLineId: string; nom: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [devise, setDevise] = useState<Devise>("USD");
  const src = `/paie/bulletin/${payrollLineId}?devise=${devise}`;

  return (
    <>
      <button onClick={() => setOuvert(true)} className="font-medium text-primary underline">
        Aperçu
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4" onClick={() => setOuvert(false)}>
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-lg bg-card px-4 py-2">
              <span className="text-sm font-semibold">Bulletin — {nom}</span>
              <div className="flex items-center gap-2">
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
                <a href={`${src}&dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                  Télécharger
                </a>
                <button onClick={() => setOuvert(false)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                  Réduire ✕
                </button>
              </div>
            </div>
            <iframe key={src} src={src} title={`Bulletin ${nom}`} className="w-full flex-1 rounded-b-lg bg-white" />
          </div>
        </div>
      )}
    </>
  );
}
