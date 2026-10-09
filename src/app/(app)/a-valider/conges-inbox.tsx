"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  approuverConge,
  refuserConge,
  supprimerConge,
  approuverCongesEnLot,
  refuserCongesEnLot,
  type RapportLotConges,
} from "../conges/actions";
import { Avatar } from "@/components/avatar";
import { BoutonApprouver, BoutonRefuser } from "@/components/action-buttons";
import { DialogueRefus } from "@/components/dialogue-refus";

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
  const [note, setNote] = useState<string | null>(null);
  // Refus : le MOTIF est obligatoire ; un seul pour toute la sélection en lot.
  const [refus, setRefus] = useState<{ ids: string[]; erreur: string | null } | null>(null);

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function bulk(fn: (ids: string[]) => Promise<RapportLotConges>) {
    const ids = [...selection];
    if (ids.length === 0) return;
    setNote(null);
    startTransition(async () => {
      const r = await fn(ids);
      setSelection(new Set());
      // Rapport de fin : l'échec d'une demande ne bloque pas les autres, mais il est NOMMÉ.
      if (r.echecs.length > 0) setNote(`${r.traitees} traitée(s), ${r.echecs.length} échec(s) — ${r.echecs.join(" · ")}`);
    });
  }
  function confirmerRefus(motif: string) {
    if (!refus) return;
    const { ids } = refus;
    setNote(null);
    startTransition(async () => {
      try {
        if (ids.length === 1) {
          const r = await refuserConge(ids[0], motif);
          if (r.erreur) { setRefus({ ids, erreur: r.erreur }); return; }
        } else {
          const r = await refuserCongesEnLot(ids, motif);
          if (r.traitees === 0 && r.echecs.length > 0) { setRefus({ ids, erreur: r.echecs.join(" · ") }); return; }
          if (r.echecs.length > 0) setNote(`${r.traitees} traitée(s), ${r.echecs.length} échec(s) — ${r.echecs.join(" · ")}`);
        }
        setSelection(new Set());
        setRefus(null);
      } catch (e) {
        setRefus({ ids, erreur: e instanceof Error && e.message ? e.message : "Le refus a échoué. Réessayez." });
      }
    });
  }
  function individuel(fn: (id: string) => Promise<unknown>, id: string) {
    setNote(null);
    startTransition(async () => {
      const r = await fn(id);
      // Une approbation qui n'a pas pu figer le solde n'est pas enregistrée : la raison est dite.
      if (r && typeof r === "object" && "erreur" in r && typeof r.erreur === "string") setNote(r.erreur);
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
      {note && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{note}</p>}
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
              <BoutonApprouver onClick={() => bulk(approuverCongesEnLot)} disabled={isPending} />
              <BoutonRefuser onClick={() => setRefus({ ids: [...selection], erreur: null })} disabled={isPending} />
              {isPending && <span className="text-xs text-muted-foreground">Traitement…</span>}
            </div>
          )}
        </div>
      )}

      {refus && (
        <DialogueRefus
          titre={refus.ids.length === 1 ? "Refuser la demande de congé" : `Refuser ${refus.ids.length} demandes de congé`}
          consigne={refus.ids.length === 1 ? `Demande de ${rows.find((r) => r.id === refus.ids[0])?.nom ?? "ce salarié"}.` : `Un même motif sera enregistré pour les ${refus.ids.length} demandes cochées.`}
          enCours={isPending} erreur={refus.erreur} onConfirmer={confirmerRefus} onAnnuler={() => setRefus(null)}
        />
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
                    <BoutonApprouver onClick={() => individuel(approuverConge, d.id)} disabled={isPending} />
                    <BoutonRefuser onClick={() => setRefus({ ids: [d.id], erreur: null })} disabled={isPending} />
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
