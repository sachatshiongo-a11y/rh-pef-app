"use client";

import { useState, useTransition } from "react";
import { definirShiftPoste, supprimerShiftPoste } from "./actions";

type ShiftPosteDTO = { id: string; poste: string; shiftId: string; ordre: number };

/** Shifts qu'un poste peut tenir, dans l'ordre de préférence. Sert à la génération automatique
 *  quand elle remplit chacun jusqu'à ses heures. */
export function ShiftPosteManager({
  postes,
  shifts,
  shiftsPoste,
}: {
  postes: string[];
  shifts: { id: string; nom: string }[];
  shiftsPoste: ShiftPosteDTO[];
}) {
  const [pending, startTransition] = useTransition();
  const [poste, setPoste] = useState("");
  const [shiftId, setShiftId] = useState("");

  const nomShift = new Map(shifts.map((s) => [s.id, s.nom]));
  const parPoste = new Map<string, ShiftPosteDTO[]>();
  for (const sp of [...shiftsPoste].sort((a, b) => a.ordre - b.ordre)) {
    parPoste.set(sp.poste, [...(parPoste.get(sp.poste) ?? []), sp]);
  }
  const postesSansShift = postes.filter((p) => !parPoste.has(p));

  const ajouter = () => {
    if (!poste || !shiftId) return;
    const ordre = (parPoste.get(poste) ?? []).length;
    startTransition(() => definirShiftPoste(poste, shiftId, ordre));
  };

  return (
    <details className="rounded-lg border bg-muted/20">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
        Shifts par poste{" "}
        <span className="font-normal text-muted-foreground">· {shiftsPoste.length} règle(s)</span>
        {postesSansShift.length > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {postesSansShift.length} poste(s) sans shift
          </span>
        )}
      </summary>
      <div className="space-y-3 p-4 pt-1">
        <p className="text-xs text-muted-foreground">
          Quand la génération automatique remplit chacun jusqu&apos;à ses heures, elle descend cette liste
          dans l&apos;ordre et prend le premier shift possible. <strong>Un poste sans shift déclaré n&apos;est
          pas rempli</strong> — le rapport de génération le signale plutôt que de poser un shift au hasard.
        </p>

        {postesSansShift.length > 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Aucun shift déclaré pour : {postesSansShift.join(", ")}.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Le poste…
            <select value={poste} onChange={(e) => setPoste(e.target.value)} className="min-w-40 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">— choisir —</option>
              {postes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <span className="pb-2 text-muted-foreground">peut tenir</span>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            …le shift
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="min-w-40 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">— choisir —</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </label>
          <button onClick={ajouter} disabled={pending || !poste || !shiftId} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Ajouter
          </button>
        </div>

        {parPoste.size > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {[...parPoste.entries()].map(([p, liste]) => (
              <li key={p} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="font-medium">{p}</span>
                <span className="text-muted-foreground">:</span>
                {liste.map((sp, i) => (
                  <span key={sp.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">
                    {i + 1}. {nomShift.get(sp.shiftId) ?? "shift"}
                    <button onClick={() => startTransition(() => supprimerShiftPoste(sp.id))} disabled={pending} className="opacity-70 hover:opacity-100" title="Retirer">✕</button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
