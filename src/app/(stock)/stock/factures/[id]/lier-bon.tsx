"use client";

import { useState, useTransition } from "react";
import { lierFactureABon } from "../actions";
import { usd } from "@/lib/stock";

type Bon = { id: string; numero: string; total: number };

export function LierBon({ factureId, bonActuelId, bons }: { factureId: string; bonActuelId: string | null; bons: Bon[] }) {
  const [choix, setChoix] = useState(bonActuelId ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const run = (bcId: string | null) => {
    setErreur(null);
    start(async () => { try { await lierFactureABon(factureId, bcId); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={choix} onChange={(e) => setChoix(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
        <option value="">— aucun bon de commande —</option>
        {bons.map((b) => <option key={b.id} value={b.id}>{b.numero} · {usd(b.total)}</option>)}
      </select>
      <button
        disabled={isPending || choix === (bonActuelId ?? "")}
        onClick={() => run(choix || null)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {choix ? "Lier" : "Détacher"}
      </button>
      {bonActuelId && choix === bonActuelId && (
        <button disabled={isPending} onClick={() => { setChoix(""); run(null); }} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">Détacher</button>
      )}
      {erreur && <span className="text-xs text-destructive">{erreur}</span>}
    </div>
  );
}
