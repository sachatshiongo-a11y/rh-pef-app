"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  approuverConge,
  refuserConge,
  supprimerConge,
  approuverCongesEnLot,
  refuserCongesEnLot,
} from "../conges/actions";
import { Avatar } from "@/components/avatar";

export type CongeRow = {
  id: string;
  employeeId: string;
  nom: string;
  photoUrl?: string | null;
  type: string;
  du: string;
  au: string;
  jours: number;
  echeanceTexte: string;
  echeanceClasse: string;
};

export function CongesInbox({ rows, peutValider }: { rows: CongeRow[]; peutValider: boolean }) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function bulk(fn: (ids: string[]) => Promise<number>) {
    const ids = [...selection];
    if (ids.length === 0) return;
    startTransition(async () => {
      await fn(ids);
      setSelection(new Set());
    });
  }
  function individuel(fn: (id: string) => Promise<unknown>, id: string) {
    startTransition(async () => {
      await fn(id);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Aucune demande de congé en attente. 🎉
      </div>
    );
  }

  return (
    <div>
      {peutValider && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={rows.every((r) => selection.has(r.id))}
              onChange={(e) => setSelection(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            />
            Tout sélectionner
          </label>
          {selection.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{selection.size} sélectionné(s) :</span>
              <button onClick={() => bulk(approuverCongesEnLot)} disabled={isPending} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-success">
                Approuver
              </button>
              <button onClick={() => bulk(refuserCongesEnLot)} disabled={isPending} className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-destructive/90">
                Refuser
              </button>
              {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((d) => {
          const estOuvert = ouvert === d.id;
          return (
            <div key={d.id} className={`rounded-xl border bg-card transition ${selection.has(d.id) ? "ring-1 ring-primary" : ""}`}>
              <div className="flex items-center gap-3 p-3">
                {peutValider && (
                  <input
                    type="checkbox"
                    checked={selection.has(d.id)}
                    onChange={() => toggle(d.id)}
                    aria-label={`Sélectionner ${d.nom}`}
                  />
                )}
                <Avatar nom={d.nom} photoUrl={d.photoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <Link href={`/employes/${d.employeeId}`} className="font-semibold hover:underline">
                      {d.nom}
                    </Link>{" "}
                    <span className="text-muted-foreground">— demande de {d.type.toLowerCase()} en attente</span>
                  </p>
                  <p className={`text-xs ${d.echeanceClasse}`}>Échéance : {d.echeanceTexte}</p>
                </div>

                {peutValider && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => individuel(approuverConge, d.id)} disabled={isPending} className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-success">
                      Approuver
                    </button>
                    <button onClick={() => individuel(refuserConge, d.id)} disabled={isPending} className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-destructive/90">
                      Refuser
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Supprimer cette demande de la liste ? (tracé au journal d'audit)"))
                          individuel(supprimerConge, d.id);
                      }}
                      disabled={isPending}
                      title="Supprimer (tracé à l'audit)"
                      className="rounded-full border px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      🗑
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setOuvert(estOuvert ? null : d.id)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-accent"
                  aria-label="Détails"
                >
                  <span className={`inline-block transition-transform ${estOuvert ? "rotate-180" : ""}`}>▾</span>
                </button>
              </div>

              {estOuvert && (
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t px-4 py-3 text-sm md:grid-cols-4">
                  <Detail label="Type" value={d.type} />
                  <Detail label="Du" value={d.du} />
                  <Detail label="Au" value={d.au} />
                  <Detail label="Durée" value={`${d.jours} jour(s)`} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
