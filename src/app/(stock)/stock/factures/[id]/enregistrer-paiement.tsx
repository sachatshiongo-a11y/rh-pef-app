"use client";

import { useState, useTransition } from "react";
import { enregistrerPaiement } from "../actions";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

/** Formulaire « Enregistrer un paiement / avoir » (total ou partiel, USD ou CDF) — replié derrière un bouton. */
export function EnregistrerPaiement({ factureId, reste, taux }: { factureId: string; reste: number; taux: number }) {
  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState<"PAIEMENT" | "AVOIR">("PAIEMENT");
  const [devise, setDevise] = useState<"USD" | "CDF">("USD");
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  if (reste <= 0.001) return null;

  const submit = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      try { await enregistrerPaiement(factureId, fd); setOuvert(false); setMontant(""); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  if (!ouvert) {
    return (
      <button onClick={() => setOuvert(true)} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
        + Paiement / Avoir
      </button>
    );
  }

  const equivalent = devise === "CDF" && taux > 0 && Number(montant) > 0 ? (Number(montant) / taux).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

  return (
    <form action={submit} className="flex w-full flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
      {erreur && <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">Type
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => setType("PAIEMENT")} className={`px-3 py-1.5 ${type === "PAIEMENT" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Paiement</button>
          <button type="button" onClick={() => setType("AVOIR")} className={`px-3 py-1.5 ${type === "AVOIR" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Avoir</button>
        </div>
        <input type="hidden" name="type" value={type} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">Devise
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => setDevise("USD")} className={`px-3 py-1.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>USD</button>
          <button type="button" onClick={() => setDevise("CDF")} className={`px-3 py-1.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>CDF (FC)</button>
        </div>
        <input type="hidden" name="devise" value={devise} />
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Montant ({devise}) *
        <input name="montant" value={montant} onChange={(e) => setMontant(e.target.value)} type="number" step={devise === "USD" ? "0.01" : "1"} min="0.01" max={devise === "USD" ? reste : undefined} required autoFocus placeholder={devise === "USD" ? reste.toFixed(2) : taux > 0 ? String(Math.round(reste * taux)) : ""} className={`${inp} w-32 text-right`} />
      </label>
      {equivalent && <span className="pb-2 text-xs text-muted-foreground">≈ {equivalent} $ (taux {taux.toLocaleString("fr-FR")})</span>}

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date
        <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inp} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Mode
        <input name="modePaiement" placeholder="Espèces, virement…" className={`${inp} w-32`} />
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">{type === "AVOIR" ? "Motif de l'avoir *" : "Note"}
        <input name="note" required={type === "AVOIR"} placeholder={type === "AVOIR" ? "ex. retour marchandise abîmée" : "ex. acompte livraison"} className={inp} />
      </label>
      <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Enregistrer"}</button>
      <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
    </form>
  );
}
