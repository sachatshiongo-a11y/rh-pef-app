"use client";

// Zone de messages d'un tableur, affichée EN TEXTE sous la grille (et annoncée par les lecteurs
// d'écran, `aria-live`) : sur un téléphone, l'infobulle `title` d'une case ne s'affiche jamais.
// Chaque case en erreur ou refusée y a sa ligne, avec son libellé (article et jour) ; le bilan
// du dernier collage aussi. Les cases l'alimentent par contexte : la zone reste montée quand une
// case disparaît (filtre, changement de jour), et son message avec.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Signaleur = {
  /** Message d'une case (null = la case est revenue à la normale). */
  signaler(cle: string, message: string | null): void;
  /** Bilan du dernier collage. */
  bilan(texte: string | null): void;
};

const Ctx = createContext<Signaleur | null>(null);
export const useSignaleur = () => useContext(Ctx);

/** Enveloppe une grille : ses cases y signalent erreurs et bilans, affichés dessous. */
export function ZoneTableur({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [bilan, setBilan] = useState<string | null>(null);
  // Stable : les cases qui le lisent ne se re-rendent jamais à cause de lui.
  const signaleur = useMemo<Signaleur>(() => ({
    signaler: (cle, message) =>
      setMessages((p) => {
        if (message === null) {
          if (!(cle in p)) return p;
          const reste = { ...p };
          delete reste[cle];
          return reste;
        }
        return p[cle] === message ? p : { ...p, [cle]: message };
      }),
    bilan: setBilan,
  }), []);
  const lignes = Object.entries(messages);

  return (
    <Ctx.Provider value={signaleur}>
      {children}
      <div role="status" aria-live="polite" className="space-y-1 empty:hidden">
        {bilan && (
          <p className="flex items-start justify-between gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900">
            <span>{bilan}</span>
            <button type="button" onClick={() => setBilan(null)} className="shrink-0 underline">Masquer</button>
          </p>
        )}
        {lignes.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <ul className="space-y-0.5">
              {lignes.map(([cle, m]) => <li key={cle}>{m}</li>)}
            </ul>
            <button type="button" onClick={() => setMessages({})} className="mt-1 underline">Masquer</button>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
