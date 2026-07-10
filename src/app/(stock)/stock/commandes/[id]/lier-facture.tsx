"use client";

import { useState, useTransition } from "react";
import { lierFactureABon } from "../../factures/actions";
import { usd } from "@/lib/stock";

type Fac = { id: string; libelle: string; montant: number };

export function LierFacture({ bcId, factures }: { bcId: string; factures: Fac[] }) {
  const [choix, setChoix] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  if (factures.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucune facture non liée de ce fournisseur à rattacher. Enregistrez la facture puis reliez-la ici.</p>;
  }

  const run = () => {
    if (!choix) return;
    setErreur(null);
    start(async () => { try { await lierFactureABon(choix, bcId); setChoix(""); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={choix} onChange={(e) => setChoix(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
        <option value="">— choisir une facture —</option>
        {factures.map((f) => <option key={f.id} value={f.id}>{f.libelle} · {usd(f.montant)}</option>)}
      </select>
      <button disabled={isPending || !choix} onClick={run} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Lier cette facture</button>
      {erreur && <span className="text-xs text-destructive">{erreur}</span>}
    </div>
  );
}
