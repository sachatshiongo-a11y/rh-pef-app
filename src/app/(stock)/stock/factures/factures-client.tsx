"use client";

import { Fragment, useState, useTransition } from "react";
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

// Colonne « échéance » : jours restants tant que non réglée, date de paiement une fois réglée.
// Code couleur : vert > 10 j, jaune de 10 j jusqu'à l'échéance, rouge une fois dépassée.
function InfoEcheance({ f }: { f: FactureRow }) {
  if (f.statut === "REGLEE") return <span className="text-emerald-700">Payée le {f.datePaiement ?? "—"}</span>;
  if (f.joursRestants === null) return <span className="text-muted-foreground">—</span>;
  if (f.joursRestants < 0) return <span className="font-medium text-red-700">En retard de {-f.joursRestants} j</span>;
  if (f.joursRestants === 0) return <span className="font-medium text-amber-700">Échéance aujourd’hui</span>;
  const couleur = f.joursRestants > 10 ? "text-emerald-700" : "text-amber-700";
  return <span className={`font-medium ${couleur}`}>{f.joursRestants} j restants</span>;
}

export function FacturesUI({ groupes }: { groupes: Groupe[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th>Fournisseur</th>
              <th>N°</th>
              <th>Date</th>
              <th>Échéance</th>
              <th>Échéance / Paiement</th>
              <th className="text-right">Montant</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-2">
            {groupes.map((g) => {
              const total = g.factures.reduce((t, f) => t + Number(f.montant), 0);
              const regle = total - g.factures.reduce((t, f) => t + f.reste, 0);
              const parFourn = Object.entries(g.factures.reduce((m, f) => { m[f.nom] = (m[f.nom] ?? 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
              return (
                <Fragment key={g.titre}>
                  <tr className="bg-muted/50">
                    <td colSpan={8} className="!py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold uppercase tracking-wide">{g.titre} · {g.factures.length} facture(s)</span>
                        <span className="text-xs text-muted-foreground">Total : <b className="text-foreground">{usd(total)}</b> · Réglé : <b className="text-emerald-700">{usd(regle)}</b></span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {parFourn.map(([nom, n]) => <span key={nom} className="rounded-full border bg-background px-2 py-0.5">{nom} ({n})</span>)}
                      </div>
                    </td>
                  </tr>
                  {g.factures.map((f) => (
                    <tr key={f.id} className="even:bg-muted/25 hover:bg-accent/40">
                      <td className="font-medium">{f.nom}</td>
                      <td className="text-muted-foreground">{f.numero ?? "—"}</td>
                      <td className="text-muted-foreground">{f.date ?? "—"}</td>
                      <td className="text-muted-foreground">{f.echeance ?? "—"}</td>
                      <td className="text-xs"><InfoEcheance f={f} /></td>
                      <td className="text-right tabular-nums">{usd(f.montant)}</td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <a href={`/stock/factures/${f.id}`} title="Détail & réconciliation" className="rounded border px-2 py-1 text-xs hover:bg-accent">Détail</a>
                          {f.statut !== "REGLEE" && (
                            <button onClick={() => run(() => marquerPayee(f.id))} disabled={isPending} className="rounded border px-2 py-1 text-xs hover:bg-accent">Marquer payée</button>
                          )}
                          <button onClick={() => { if (confirm("Supprimer cette facture ?")) run(() => supprimerFacture(f.id)); }} disabled={isPending} title="Supprimer" className="rounded border px-2 py-1 text-xs text-destructive hover:bg-destructive/10">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {groupes.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Aucune facture.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
