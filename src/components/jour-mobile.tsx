"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// État partagé du « jour sélectionné » (index 0-based dans isoDates) pour la vue mobile jour-par-jour.
// Permet à plusieurs grilles d'une même page (ex. Brigade + Back-office) de partager UN seul sélecteur.
// Sert aussi à l'espace Stock (Conso. journalière, Stock restaurant) : le sélecteur de jour du haut
// de page et la liste du jour, plus loin dans la page, lisent le même état. `semaine` = l'option
// « Vue semaine » du téléphone (le tableau de la semaine qui défile de côté, au lieu d'un jour).
const Ctx = createContext<{ idx: number; setIdx: (n: number) => void; semaine: boolean; setSemaine: (v: boolean) => void } | null>(null);

export function JourMobileProvider({ defaultIdx, children }: { defaultIdx: number; children: ReactNode }) {
  const [idx, setIdx] = useState(defaultIdx);
  const [semaine, setSemaine] = useState(false);
  return <Ctx.Provider value={{ idx, setIdx, semaine, setSemaine }}>{children}</Ctx.Provider>;
}

/** Renvoie [idx, setIdx] partagé si un provider englobe le composant, sinon un état local (grille isolée). */
export function useJourMobile(defaultIdx: number): [number, (n: number) => void] {
  const ctx = useContext(Ctx);
  const [local, setLocal] = useState(defaultIdx);
  return ctx ? [ctx.idx, ctx.setIdx] : [local, setLocal];
}

/** « Vue semaine » du téléphone : partagée avec le provider si présent, sinon état local. */
export function useVueSemaine(): [boolean, (v: boolean) => void] {
  const ctx = useContext(Ctx);
  const [local, setLocal] = useState(false);
  return ctx ? [ctx.semaine, ctx.setSemaine] : [local, setLocal];
}
