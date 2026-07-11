"use client";

import { useState, useTransition } from "react";
import { definirPolyvalence, supprimerPolyvalence } from "./actions";

type PolyDTO = { id: string; posteSource: string; posteCible: string };

/** Polyvalence des postes : « tel poste peut couvrir tel autre » quand les titulaires manquent
 *  à la génération automatique. */
export function PolyvalenceManager({ postes, polyvalences }: { postes: string[]; polyvalences: PolyDTO[] }) {
  const [pending, startTransition] = useTransition();
  const [source, setSource] = useState("");
  const [cible, setCible] = useState("");

  const ajouter = () => {
    if (!source || !cible || source === cible) return;
    startTransition(() => definirPolyvalence(source, cible));
  };

  return (
    <details className="rounded-lg border bg-muted/20">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
        Polyvalence des postes <span className="font-normal text-muted-foreground">· {polyvalences.length} règle(s)</span>
      </summary>
      <div className="space-y-3 p-4 pt-1">
        <p className="text-xs text-muted-foreground">
          Quand les titulaires d&apos;un poste ne suffisent pas à couvrir un besoin, la génération automatique
          pioche dans les postes déclarés capables de le couvrir (mêmes règles : congés, heures, équité).
        </p>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Le poste…
            <select value={source} onChange={(e) => setSource(e.target.value)} className="min-w-40 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">— choisir —</option>
              {postes.map((p) => <option key={p} value={p} disabled={p === cible}>{p}</option>)}
            </select>
          </label>
          <span className="pb-2 text-muted-foreground">peut couvrir</span>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">…le poste
            <select value={cible} onChange={(e) => setCible(e.target.value)} className="min-w-40 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">— choisir —</option>
              {postes.map((p) => <option key={p} value={p} disabled={p === source}>{p}</option>)}
            </select>
          </label>
          <button onClick={ajouter} disabled={pending || !source || !cible || source === cible} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Ajouter</button>
        </div>
        {polyvalences.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {polyvalences.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span><span className="font-medium">{p.posteSource}</span> <span className="text-muted-foreground">peut couvrir</span> <span className="font-medium">{p.posteCible}</span></span>
                <button onClick={() => startTransition(() => supprimerPolyvalence(p.id))} disabled={pending} className="text-xs text-destructive underline disabled:opacity-50">Retirer</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
