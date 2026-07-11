"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useBulkSelection, BulkBar } from "@/components/bulk-bar";
import { MoisAccordeon } from "@/components/mois-accordeon";
import { grouperParMois } from "@/lib/dates-fr";
import { validerBonsEnLot, supprimerBonsEnLot } from "./actions";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE } from "@/lib/stock";

export type BCRow = {
  id: string; numero: string; fournisseurId: string | null; fournisseurNom: string | null;
  date: string; nbLignes: number; total: number; statut: string; documentUrl: string | null;
};

export function CommandesListe({ commandes, estDirection }: { commandes: BCRow[]; estDirection: boolean }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const brouillons = ids.filter((id) => commandes.some((c) => c.id === id && c.statut === "BROUILLON"));
  const run = (fn: () => Promise<void>) => { setErreur(null); start(async () => { try { await fn(); clear(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } }); };
  const pdfLien = (c: BCRow) => c.documentUrl
    ? <a href={c.documentUrl} target="_blank" rel="noopener" className="text-primary underline">PDF</a>
    : c.statut !== "BROUILLON" && c.statut !== "ANNULE" ? <a href={`/stock/commandes/${c.id}/pdf`} download className="text-primary underline">PDF</a> : null;

  return (
    <div className="space-y-2">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {estDirection && commandes.length > 0 && (
        <BulkBar count={sel.size} total={commandes.length} onAll={(on) => setAll(commandes.map((c) => c.id), on)}>
          <button disabled={isPending || brouillons.length === 0} onClick={() => run(() => validerBonsEnLot(brouillons))} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">✓ Valider ({brouillons.length})</button>
          <button disabled={isPending} onClick={() => { if (confirm(`Supprimer ${sel.size} bon(s) de commande ?`)) run(() => supprimerBonsEnLot(ids)); }} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">✕ Supprimer ({sel.size})</button>
          <button onClick={clear} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Désélectionner</button>
        </BulkBar>
      )}

      {commandes.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun bon de commande pour ce filtre.</p>
      ) : (
        grouperParMois(commandes, (c) => c.date).map((g, i) => (
          <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} bon(s)`} resume={usd(g.items.reduce((t, c) => t + c.total, 0))} defaultOpen={i === 0}>
            <ul className="divide-y border-t text-sm">
              {g.items.map((c) => (
                <li key={c.id} className={`flex items-center gap-2 px-3 py-1.5 ${sel.has(c.id) ? "bg-primary/10" : "hover:bg-accent/40"}`}>
                  {estDirection && <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="shrink-0" aria-label={`Sélectionner ${c.numero}`} />}
                  <div className="min-w-0 flex-1">
                    <Link href={`/stock/commandes/${c.id}`} className="font-medium text-primary hover:underline">{c.numero}</Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.fournisseurId ? <Link href={`/stock/fournisseurs/${c.fournisseurId}`} className="text-primary hover:underline">{c.fournisseurNom}</Link> : (c.fournisseurNom ?? "—")} · {new Date(c.date).toLocaleDateString("fr-FR")} · {c.nbLignes} ligne(s)
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[c.statut]}`}>{STATUT_BC_LABEL[c.statut]}</span>
                    <span className="font-semibold tabular-nums">{usd(c.total)}</span>
                    {pdfLien(c)}
                  </span>
                </li>
              ))}
            </ul>
          </MoisAccordeon>
        ))
      )}
    </div>
  );
}
