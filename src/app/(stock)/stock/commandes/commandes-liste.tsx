"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useBulkSelection, BulkBar } from "@/components/bulk-bar";
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

      {/* Mobile : cartes. */}
      <div className="space-y-2 lg:hidden">
        {commandes.map((c) => (
          <div key={c.id} className={`flex gap-2 rounded-xl border bg-card p-3 ${sel.has(c.id) ? "ring-1 ring-primary" : ""}`}>
            {estDirection && <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="mt-1 shrink-0" aria-label={`Sélectionner ${c.numero}`} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/stock/commandes/${c.id}`} className="font-medium text-primary hover:underline">{c.numero}</Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.fournisseurId ? <Link href={`/stock/fournisseurs/${c.fournisseurId}`} className="text-primary hover:underline">{c.fournisseurNom}</Link> : (c.fournisseurNom ?? "—")} · {new Date(c.date).toLocaleDateString("fr-FR")}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[c.statut]}`}>{STATUT_BC_LABEL[c.statut]}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{c.nbLignes} ligne(s)</span>
                <span className="font-semibold tabular-nums">{usd(c.total)}</span>
              </div>
              <div className="mt-2 flex gap-3 text-sm">
                <Link href={`/stock/commandes/${c.id}`} className="text-primary underline">Ouvrir</Link>
                {pdfLien(c)}
              </div>
            </div>
          </div>
        ))}
        {commandes.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun bon de commande pour ce filtre.</p>}
      </div>

      {/* Ordinateur : tableau. */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-lg border lg:block">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              {estDirection && <th className="w-8 px-3 py-2"></th>}
              <th className="px-3 py-2">Numéro</th>
              <th className="px-3 py-2">Fournisseur</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-right">Lignes</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => (
              <tr key={c.id} className={`border-t hover:bg-accent/40 ${sel.has(c.id) ? "bg-primary/10" : "even:bg-muted/25"}`}>
                {estDirection && <td className="px-3 py-2"><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Sélectionner ${c.numero}`} /></td>}
                <td className="px-3 py-2 font-medium">{c.numero}</td>
                <td className="px-3 py-2">{c.fournisseurId ? <Link href={`/stock/fournisseurs/${c.fournisseurId}`} className="text-primary hover:underline">{c.fournisseurNom}</Link> : (c.fournisseurNom ?? "—")}</td>
                <td className="px-3 py-2 text-muted-foreground">{new Date(c.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-2 text-right">{c.nbLignes}</td>
                <td className="px-3 py-2 text-right">{usd(c.total)}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[c.statut]}`}>{STATUT_BC_LABEL[c.statut]}</span></td>
                <td className="px-3 py-2 text-right"><div className="flex justify-end gap-2"><Link href={`/stock/commandes/${c.id}`} className="text-primary underline">Ouvrir</Link>{pdfLien(c)}</div></td>
              </tr>
            ))}
            {commandes.length === 0 && <tr><td colSpan={estDirection ? 8 : 7} className="px-3 py-6 text-center text-muted-foreground">Aucun bon de commande pour ce filtre.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
