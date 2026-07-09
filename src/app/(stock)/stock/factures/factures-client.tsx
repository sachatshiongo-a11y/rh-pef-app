"use client";

import { useState, useTransition } from "react";
import { marquerPayee, supprimerFacture } from "./actions";
import { usd, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";

export type FactureRow = {
  id: string;
  nom: string;
  numero: string | null;
  date: string | null;
  echeance: string | null;
  joursRestants: number | null; // null si réglée ou sans échéance
  datePaiement: string | null;
  montant: string;
  reste: number;
  statut: string;
};

export type Groupe = { titre: string; factures: FactureRow[] };

// Pastille d'échéance : verte > 10 j, jaune ≤ 10 j, rouge en retard, verte « payée » une fois réglée.
function badgeEcheance(f: FactureRow): { texte: string; cls: string } | null {
  if (f.statut === "REGLEE") return { texte: `Payée le ${f.datePaiement ?? "—"}`, cls: "bg-emerald-100 text-emerald-800" };
  if (f.joursRestants === null) return null;
  if (f.joursRestants < 0) return { texte: `En retard de ${-f.joursRestants} j`, cls: "bg-red-100 text-red-800" };
  if (f.joursRestants === 0) return { texte: "Échéance aujourd’hui", cls: "bg-amber-100 text-amber-800" };
  return { texte: `${f.joursRestants} j restants`, cls: f.joursRestants > 10 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800" };
}

export function FacturesUI({ groupes }: { groupes: Groupe[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  return (
    <div className="space-y-4">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {groupes.map((g) => {
        const total = g.factures.reduce((t, f) => t + Number(f.montant), 0);
        const regle = total - g.factures.reduce((t, f) => t + f.reste, 0);
        const parFourn = Object.entries(g.factures.reduce((m, f) => { m[f.nom] = (m[f.nom] ?? 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
        return (
          <section key={g.titre} className="overflow-hidden rounded-xl border">
            <div className="border-b bg-muted/50 px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold uppercase tracking-wide">{g.titre} · {g.factures.length} facture(s)</span>
                <span className="text-sm">Total <b>{usd(total)}</b> · Réglé <b className="text-emerald-700">{usd(regle)}</b></span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                {parFourn.map(([nom, n]) => <span key={nom} className="rounded-full border bg-background px-2 py-0.5">{nom} ({n})</span>)}
              </div>
            </div>

            <ul className="divide-y">
              {g.factures.map((f) => {
                const be = badgeEcheance(f);
                return (
                  <li key={f.id} className="px-3 py-3 hover:bg-accent/30 sm:px-4">
                    <div className="flex items-start justify-between gap-3">
                      {/* Fournisseur + N° (bien visible) + date */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{f.nom}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {f.numero ? (
                            <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-sm font-semibold tracking-wide text-foreground">N° {f.numero}</span>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Sans numéro</span>
                          )}
                          <span className="text-xs text-muted-foreground">{f.date ? `émise le ${f.date}` : ""}</span>
                        </div>
                      </div>
                      {/* Montant */}
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-semibold tabular-nums">{usd(f.montant)}</p>
                        <p className="text-[11px] text-muted-foreground">échéance {f.echeance ?? "—"}</p>
                      </div>
                    </div>

                    {/* Badges + actions (s'enroulent proprement sur mobile) */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span>
                      {be && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${be.cls}`}>{be.texte}</span>}
                      <div className="ml-auto flex items-center gap-2">
                        <a href={`/stock/factures/${f.id}`} title="Détail & réconciliation" className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Détail</a>
                        {f.statut !== "REGLEE" && (
                          <button onClick={() => run(() => marquerPayee(f.id))} disabled={isPending} className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Marquer payée</button>
                        )}
                        <button onClick={() => { if (confirm("Supprimer cette facture ?")) run(() => supprimerFacture(f.id)); }} disabled={isPending} title="Supprimer" className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10">✕</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {groupes.length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
    </div>
  );
}
