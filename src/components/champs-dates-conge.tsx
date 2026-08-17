"use client";

import { useState } from "react";

/** Même règle que la paie (calculerJoursOuvrables) : dimanches et jours fériés exclus,
 *  le samedi est OUVRABLE (semaine de 6 jours, usage RDC). */
function joursOuvrables(debut: string, fin: string, feries: Set<string>): number | null {
  if (!debut || !fin) return null;
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime()) || f < d) return null;
  let n = 0;
  const cur = new Date(d);
  while (cur <= f) {
    if (cur.getUTCDay() !== 0 && !feries.has(cur.toISOString().slice(0, 10))) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

/**
 * Les deux champs de dates d'une demande de congé + décompte EN DIRECT des jours ouvrables
 * entre la prise et le retour. Partagé entre le formulaire Direction et l'espace salarié.
 * Rend deux cellules sœurs (fragment) : s'insère tel quel dans la grille du formulaire.
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
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const n = joursOuvrables(debut, fin, new Set(feries));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateDebut" className="text-sm font-medium">{labelDebut}</label>
        <input
          id="dateDebut"
          name="dateDebut"
          type="date"
          required
          min={min}
          value={debut}
          onChange={(e) => setDebut(e.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateFin" className="text-sm font-medium">{labelFin}</label>
        <input
          id="dateFin"
          name="dateFin"
          type="date"
          required
          min={debut || min}
          value={fin}
          onChange={(e) => setFin(e.target.value)}
          className={inputClassName}
        />
        {n !== null && (
          <p className="text-xs font-medium text-primary">
            soit {n} jour{n > 1 ? "s" : ""} ouvrable{n > 1 ? "s" : ""}
            <span className="font-normal text-muted-foreground"> (hors dimanches et fériés)</span>
          </p>
        )}
      </div>
    </>
  );
}
