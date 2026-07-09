"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// État partagé du « jour sélectionné » (index 0-based dans isoDates) pour la vue mobile jour-par-jour.
// Permet à plusieurs grilles d'une même page (ex. Brigade + Back-office) de partager UN seul sélecteur.
const Ctx = createContext<{ idx: number; setIdx: (n: number) => void } | null>(null);

export function JourMobileProvider({ defaultIdx, children }: { defaultIdx: number; children: ReactNode }) {
  const [idx, setIdx] = useState(defaultIdx);
  return <Ctx.Provider value={{ idx, setIdx }}>{children}</Ctx.Provider>;
}

/** Renvoie [idx, setIdx] partagé si un provider englobe le composant, sinon un état local (grille isolée). */
export function useJourMobile(defaultIdx: number): [number, (n: number) => void] {
  const ctx = useContext(Ctx);
  const [local, setLocal] = useState(defaultIdx);
  return ctx ? [ctx.idx, ctx.setIdx] : [local, setLocal];
}
