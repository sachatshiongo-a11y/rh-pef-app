"use client";

import { useState } from "react";
import { recalculerChampsConge, CHAMPS_CONGE_VIDES, type ChampConge } from "@/lib/jours-ouvrables";

/**
 * Les trois champs d'une demande de congé — Date début · Jours ouvrables · Date fin — avec
 * recalcul EN DIRECT : les jours et la fin se recalculent l'un l'autre, le dernier touché a
 * raison (règle dans `lib/jours-ouvrables`, testée là-bas). Partagé entre le formulaire Direction
 * et l'espace salarié. Rend trois cellules sœurs (fragment) : s'insère tel quel dans la grille.
 *
 * Le serveur recalcule les jours depuis les dates et refuse un écart : ce composant aide à saisir,
 * il ne décide de rien.
 */
export function ChampsDatesConge({
  feries,
  inputClassName,
  min,
  labelDebut = "Date début",
  labelFin = "Date fin",
}: {
  feries: string[]; // jours fériés au format AAAA-MM-JJ
  inputClassName: string;
  min?: string; // date minimale (ex. aujourd'hui, côté salarié)
  labelDebut?: string;
  labelFin?: string;
}) {
  const [etat, setEtat] = useState(CHAMPS_CONGE_VIDES);
  const feriesSet = new Set(feries);
  const toucher = (champ: ChampConge) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEtat((s) => recalculerChampsConge(s, champ, e.target.value, feriesSet));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateDebut" className="text-sm font-medium">{labelDebut}</label>
        <input id="dateDebut" name="dateDebut" type="date" required min={min} value={etat.debut} onChange={toucher("debut")} className={inputClassName} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="nbJours" className="text-sm font-medium">Jours ouvrables</label>
        <input id="nbJours" name="nbJours" type="number" inputMode="numeric" required min={1} step={1} value={etat.jours} onChange={toucher("jours")} className={inputClassName} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateFin" className="text-sm font-medium">{labelFin}</label>
        <input id="dateFin" name="dateFin" type="date" required min={etat.debut || min} value={etat.fin} onChange={toucher("fin")} className={inputClassName} />
        <p className="text-xs text-muted-foreground">Dimanches et jours fériés exclus.</p>
      </div>
    </>
  );
}
