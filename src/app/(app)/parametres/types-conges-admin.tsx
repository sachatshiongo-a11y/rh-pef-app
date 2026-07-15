"use client";

import { useState, useTransition } from "react";
import {
  creerTypeConge,
  modifierTypeConge,
  basculerTypeConge,
  supprimerTypeConge,
} from "./typeconge-actions";
import { estErreur } from "@/lib/action-lisible";

export type TypeCongeRow = {
  id: string;
  nom: string;
  joursPayes: number | null;
  tauxPct: number | null;
  systeme: boolean;
  actif: boolean;
};

const inputCls = "rounded border border-input bg-background px-2 py-1 text-sm";

export function TypesCongesAdmin({ types }: { types: TypeCongeRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>) {
    setErreur(null);
    startTransition(async () => {
      const r = await fn();
      if (estErreur(r)) setErreur(r.erreur);
    });
  }

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full text-sm [&_td]:px-3 [&_th]:px-3">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="py-2">Type</th>
              <th className="py-2 text-center">Jours payés</th>
              <th className="py-2 text-center">Taux %</th>
              <th className="py-2 text-center">Statut</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="py-1.5">
                  <form action={(fd) => run(() => modifierTypeConge(t.id, fd))} className="flex items-center gap-2">
                    <input name="nom" defaultValue={t.nom} className={`${inputCls} w-44`} />
                    <input name="joursPayes" type="number" defaultValue={t.joursPayes ?? ""} placeholder="À valider" className={`${inputCls} w-24`} />
                    <input name="tauxPct" type="number" defaultValue={t.tauxPct ?? ""} placeholder="À valider" className={`${inputCls} w-20`} />
                    <button disabled={isPending} className="rounded border px-2 py-1 text-xs hover:bg-accent">Enregistrer</button>
                  </form>
                </td>
                <td className="py-1.5 text-center">{t.joursPayes ?? <span className="text-amber-600">À valider</span>}</td>
                <td className="py-1.5 text-center">{t.tauxPct ?? <span className="text-amber-600">À valider</span>}</td>
                <td className="py-1.5 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.actif ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
                    {t.actif ? "Actif" : "Inactif"}
                  </span>
                </td>
                <td className="py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => run(() => basculerTypeConge(t.id))} disabled={isPending} className="rounded border px-2 py-1 text-xs hover:bg-accent">
                      {t.actif ? "Désactiver" : "Activer"}
                    </button>
                    {!t.systeme && (
                      <button
                        onClick={() => { if (confirm("Supprimer ce type de congé ?")) run(() => supprimerTypeConge(t.id)); }}
                        disabled={isPending}
                        className="rounded border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={(fd) => run(() => creerTypeConge(fd))} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <input name="nom" placeholder="Nouveau type (ex. Congé exceptionnel)" required className={`${inputCls} flex-1`} />
        <input name="joursPayes" type="number" placeholder="Jours payés" className={`${inputCls} w-28`} />
        <input name="tauxPct" type="number" placeholder="Taux %" className={`${inputCls} w-24`} />
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Ajouter</button>
      </form>
      <p className="text-xs text-muted-foreground">
        Jours payés / taux laissés vides = <span className="font-medium text-amber-600">À valider</span> par un
        comptable-juriste (non appliqués en paie tant que non renseignés).
      </p>
    </div>
  );
}
