"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  approuverAcompte,
  refuserAcompte,
  approuverAcomptesEnLot,
  refuserAcomptesEnLot,
} from "../paie/remuneration-actions";
import type { DecisionAcompte, ResultatLotAcomptes } from "@/lib/acompte-plafond";
import { Avatar } from "@/components/avatar";

export type AcompteRow = {
  id: string;
  employeeId: string;
  nom: string;
  photoUrl?: string | null;
  montant: string;
  periode: string;
  motif: string | null;
  demandeLe: string;
};

export function AcomptesInbox({ rows, peutValider }: { rows: AcompteRow[]; peutValider: boolean }) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function bulk(fn: (ids: string[]) => Promise<ResultatLotAcomptes>) {
    const ids = [...selection];
    if (ids.length === 0) return;
    startTransition(async () => {
      const r = await fn(ids);
      setSelection(new Set());
      // Un acompte hors plafond n'annule pas le lot : on dit combien sont passés et pourquoi les
      // autres ne le sont pas, plutôt que de laisser l'écran se rafraîchir en silence.
      setAvis(
        r.bloques > 0
          ? `${r.traites} acompte(s) traité(s), ${r.bloques} bloqué(s) par le plafond. ${r.message ?? ""}`.trim()
          : null
      );
    });
  }
  function individuel(fn: (id: string) => Promise<DecisionAcompte>, id: string) {
    startTransition(async () => {
      const r = await fn(id);
      setAvis(r.ok ? null : r.message);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Aucune demande d&apos;acompte en attente.
      </div>
    );
  }

  return (
    <div>
      {avis && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{avis}</p>}
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
              <button onClick={() => bulk(approuverAcomptesEnLot)} disabled={isPending} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-success">
                Approuver
              </button>
              <button onClick={() => bulk(refuserAcomptesEnLot)} disabled={isPending} className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-destructive/90">
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
                    <span className="text-muted-foreground">— demande d&apos;acompte de {d.montant} en attente</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Sur la paie de {d.periode}</p>
                </div>

                {peutValider && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => individuel(approuverAcompte, d.id)} disabled={isPending} className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-success">
                      Approuver
                    </button>
                    <button onClick={() => individuel(refuserAcompte, d.id)} disabled={isPending} className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-destructive/90">
                      Refuser
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
                  <Detail label="Montant" value={d.montant} />
                  <Detail label="Période de paie" value={d.periode} />
                  <Detail label="Motif" value={d.motif || "—"} />
                  <Detail label="Demandé le" value={d.demandeLe} />
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
