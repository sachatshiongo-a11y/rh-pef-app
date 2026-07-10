"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { marquerPayee, supprimerFacture, marquerPayeesEnLot, supprimerFacturesEnLot } from "./actions";
import { usd, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";

export type FactureRow = {
  id: string;
  nom: string;
  fournisseurId: string | null;
  numero: string | null;
  date: string | null;
  echeance: string | null;
  joursRestants: number | null; // null si réglée ou sans échéance
  datePaiement: string | null;
  montant: string;
  reste: number;
  statut: string;
  documentUrl: string | null;
};

export type Groupe = { titre: string; factures: FactureRow[] };
export type MoisGroupe = { cle: string; label: string; factures: FactureRow[] };
export type AnneeGroupe = { annee: number; mois: MoisGroupe[] };

const sumReste = (fs: FactureRow[]) => fs.reduce((t, f) => t + f.reste, 0);

// Pastille d'échéance : verte > 10 j, jaune ≤ 10 j, rouge en retard, verte « payée » une fois réglée.
function badgeEcheance(f: FactureRow): { texte: string; cls: string } | null {
  if (f.statut === "REGLEE") return { texte: `Payée le ${f.datePaiement ?? "—"}`, cls: "bg-emerald-100 text-emerald-800" };
  if (f.joursRestants === null) return null;
  if (f.joursRestants < 0) return { texte: `En retard de ${-f.joursRestants} j`, cls: "bg-red-100 text-red-800" };
  if (f.joursRestants === 0) return { texte: "Échéance aujourd’hui", cls: "bg-amber-100 text-amber-800" };
  return { texte: `${f.joursRestants} j restants`, cls: f.joursRestants > 10 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800" };
}

const sommaireCls = "flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden";

export function FacturesUI({ groupes, annees, estDirection = true }: { groupes?: Groupe[]; annees?: AnneeGroupe[]; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  // Toutes les factures affichées (à plat), pour « tout sélectionner » et les actions groupées.
  const toutes = useMemo(() => {
    const acc: FactureRow[] = [];
    if (annees) for (const a of annees) for (const m of a.mois) acc.push(...m.factures);
    else for (const g of groupes ?? []) acc.push(...g.factures);
    return acc;
  }, [annees, groupes]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clear = () => setSel(new Set());
  const selIds = [...sel];
  const selNonReglees = selIds.filter((id) => toutes.some((f) => f.id === id && f.statut !== "REGLEE"));

  const liste = (factures: FactureRow[]) => (
    <ul className="divide-y border-t">
      {factures.map((f) => {
        const be = badgeEcheance(f);
        return (
          <li key={f.id} className={`flex gap-3 px-3 py-3 hover:bg-accent/30 sm:px-4 ${sel.has(f.id) ? "bg-primary/5" : ""}`}>
            <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="mt-1 shrink-0" aria-label={`Sélectionner ${f.nom}`} />
            <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {f.fournisseurId
                  ? <Link href={`/stock/fournisseurs/${f.fournisseurId}`} className="truncate font-semibold text-primary hover:underline">{f.nom}</Link>
                  : <p className="truncate font-semibold">{f.nom}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {f.numero ? (
                    <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-sm font-semibold tracking-wide text-foreground">N° {f.numero}</span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">Sans numéro</span>
                  )}
                  <span className="text-xs text-muted-foreground">{f.date ? `émise le ${f.date}` : ""}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-semibold tabular-nums">{usd(f.montant)}</p>
                <p className="text-[11px] text-muted-foreground">échéance {f.echeance ?? "—"}</p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span>
              {be && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${be.cls}`}>{be.texte}</span>}
              <div className="ml-auto flex items-center gap-2">
                {f.documentUrl && (
                  <a href={f.documentUrl} target="_blank" rel="noopener noreferrer" title="PDF de la facture" className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">📄 PDF</a>
                )}
                <a href={`/stock/factures/${f.id}`} title="Détail & réconciliation" className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Détail</a>
                {f.statut !== "REGLEE" && (
                  <button onClick={() => run(() => marquerPayee(f.id))} disabled={isPending} className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Marquer payée</button>
                )}
                {estDirection && (
                  <button onClick={() => { if (confirm("Supprimer cette facture ?")) run(() => supprimerFacture(f.id)); }} disabled={isPending} title="Supprimer" className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10">✕</button>
                )}
              </div>
            </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-2">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {/* Barre d'actions groupées — sélection multiple par cases à cocher. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={toutes.length > 0 && sel.size === toutes.length}
            ref={(el) => { if (el) el.indeterminate = sel.size > 0 && sel.size < toutes.length; }}
            onChange={(e) => setSel(e.target.checked ? new Set(toutes.map((f) => f.id)) : new Set())}
          />
          Tout sélectionner
        </label>
        <span className="text-sm text-muted-foreground">{sel.size} sélectionnée(s)</span>
        {sel.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => run(async () => { await marquerPayeesEnLot(selNonReglees); clear(); })}
              disabled={isPending || selNonReglees.length === 0}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              ✓ Marquer payées ({selNonReglees.length})
            </button>
            {estDirection && (
              <button
                onClick={() => { if (confirm(`Supprimer ${sel.size} facture(s) ? Le stock entré par ces factures sera repris.`)) run(async () => { await supprimerFacturesEnLot(selIds); clear(); }); }}
                disabled={isPending}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                ✕ Supprimer ({sel.size})
              </button>
            )}
            <button onClick={clear} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Désélectionner</button>
          </div>
        )}
      </div>

      {annees ? (
        <>
          {annees.map((a) => {
            const nbA = a.mois.reduce((n, m) => n + m.factures.length, 0);
            const duA = a.mois.reduce((n, m) => n + sumReste(m.factures), 0);
            return (
              <details key={a.annee} className="group overflow-hidden rounded-xl border">
                <summary className={`${sommaireCls} bg-muted/60 px-4 py-2.5 text-sm font-semibold`}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{a.annee} <span className="font-normal text-muted-foreground">· {nbA} facture(s)</span></span>
                  {duA > 0 ? <span className="text-red-700">dû {usd(duA)}</span> : <span className="text-emerald-700">soldé</span>}
                </summary>
                <div className="space-y-1.5 p-2">
                  {a.mois.map((m) => {
                    const duM = sumReste(m.factures);
                    return (
                      <details key={m.cle} className="group/m overflow-hidden rounded-lg border">
                        <summary className={`${sommaireCls} bg-muted/30 px-3 py-1.5 text-sm font-medium`}>
                          <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open/m:rotate-90">▸</span>{m.label} <span className="font-normal text-muted-foreground">· {m.factures.length}</span></span>
                          {duM > 0 ? <span className="text-xs text-red-700">dû {usd(duM)}</span> : <span className="text-xs text-emerald-700">soldé</span>}
                        </summary>
                        {liste(m.factures)}
                      </details>
                    );
                  })}
                </div>
              </details>
            );
          })}
          {annees.length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      ) : (
        <>
          {(groupes ?? []).map((g) => {
            const total = g.factures.reduce((t, f) => t + Number(f.montant), 0);
            const regle = total - sumReste(g.factures);
            return (
              <details key={g.titre} className="group overflow-hidden rounded-xl border">
                <summary className={`${sommaireCls} bg-muted/60 px-4 py-2.5 text-sm font-semibold`}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{g.titre} <span className="font-normal text-muted-foreground">· {g.factures.length} facture(s)</span></span>
                  <span className="text-xs font-normal">Réglé <b className="text-emerald-700">{usd(regle)}</b> / {usd(total)}</span>
                </summary>
                {liste(g.factures)}
              </details>
            );
          })}
          {(groupes ?? []).length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      )}
    </div>
  );
}
