"use client";

import { useState, useTransition } from "react";
import { enregistrerPaiement } from "../actions";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

/** Formulaire « Enregistrer un paiement » (total ou partiel) — replié derrière un bouton. */
export function EnregistrerPaiement({ factureId, reste }: { factureId: string; reste: number }) {
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  if (reste <= 0.001) return null;

  const submit = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      try { await enregistrerPaiement(factureId, fd); setOuvert(false); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  if (!ouvert) {
    return (
      <button onClick={() => setOuvert(true)} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
        + Paiement (acompte…)
      </button>
    );
  }

  return (
    <form action={submit} className="flex w-full flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
      {erreur && <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Montant (USD) *
        <input name="montant" type="number" step="0.01" min="0.01" max={reste} required autoFocus placeholder={reste.toFixed(2)} className={`${inp} w-28 text-right`} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date
        <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inp} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Mode
        <input name="modePaiement" placeholder="Espèces, virement…" className={`${inp} w-36`} />
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">Note
        <input name="note" placeholder="ex. acompte livraison" className={inp} />
      </label>
      <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Enregistrer"}</button>
      <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
    </form>
  );
}
