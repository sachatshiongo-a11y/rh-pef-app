"use client";

import { useState } from "react";
import { genererPlanningAuto } from "./actions";

const JOURS = [
  { v: 1, l: "Lun" },
  { v: 2, l: "Mar" },
  { v: 3, l: "Mer" },
  { v: 4, l: "Jeu" },
  { v: 5, l: "Ven" },
  { v: 6, l: "Sam" },
  { v: 0, l: "Dim" },
];

export function AutoPlanningForm({
  debut,
  fin,
  shifts,
}: {
  debut: string;
  fin: string;
  shifts: { id: string; nom: string }[];
}) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOuvert((o) => !o)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
        Générer automatiquement
      </button>

      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border bg-card p-4 shadow-lg">
            <p className="mb-3 text-sm font-semibold">Paramètres de génération</p>
            <form
              action={genererPlanningAuto.bind(null, debut, fin)}
              onSubmit={() => setOuvert(false)}
              className="space-y-3 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Shift à affecter</span>
                <select name="shiftId" defaultValue="" className="rounded border border-input bg-background px-2 py-1.5">
                  <option value="">Automatique (1er shift de jour)</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>{s.nom}</option>
                  ))}
                </select>
              </label>

              <div>
                <span className="text-xs text-muted-foreground">Jours de la semaine</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {JOURS.map((j) => (
                    <label key={j.v} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                      <input type="checkbox" name="jours" value={j.v} defaultChecked={j.v !== 0} />
                      {j.l}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Jours / semaine (0 = selon les heures)</span>
                <input name="nbParSemaine" type="number" min="0" max="7" defaultValue="0" className="w-16 rounded border border-input bg-background px-2 py-1" />
              </label>

              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="modeles" value="on" defaultChecked /> Utiliser les modèles hebdomadaires (rôles fixes par jour)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="inclureFeries" /> Couvrir aussi les jours fériés
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="ecraser" /> Écraser et régénérer toute la période
              </label>

              <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                Générer le planning
              </button>
              <p className="text-[11px] text-muted-foreground">
                Sans « écraser », seuls les créneaux vides sont remplis (vos saisies sont conservées).
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
