"use client";

import { useState, useTransition } from "react";
import { entreeListeAchat } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";

type Art = { id: string; designation: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function ListeAchatForm({ articles, taux, estDirection = false }: { articles: Art[]; taux: number; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [nbLignes, setNbLignes] = useState(4);
  const [devise, setDevise] = useState<"USD" | "CDF">("USD");
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); setNbLignes(4); setDevise("USD"); setCle((c) => c + 1); };

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try {
        await entreeListeAchat(fd);
        setMsg({ ok: true, texte: "Entrées enregistrées : le stock a été mis à jour." });
        setNbLignes(4);
        setCle((c) => c + 1);
      } catch (e) {
        setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." });
      }
    });
  };

  return (
    <form key={cle} action={submit} className="space-y-3">
      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.texte}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Origine / libellé (optionnel)</span>
          <input name="origine" placeholder="Liste d'achat semaine… / Achat légumes frais" className={inp} />
        </label>
        <div className="text-sm">
          <span className="text-muted-foreground">Devise du montant</span>
          <div className="mt-1 inline-flex overflow-hidden rounded-md border">
            <button type="button" onClick={() => setDevise("USD")} className={`px-3 py-1.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>USD</button>
            <button type="button" onClick={() => setDevise("CDF")} className={`px-3 py-1.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>CDF (FC)</button>
          </div>
          <input type="hidden" name="devise" value={devise} />
        </div>
        {devise === "CDF" && <span className="pb-1.5 text-xs text-muted-foreground">Taux : 1 USD = {taux.toLocaleString("fr-FR")} FC (converti automatiquement)</span>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-64 flex-1">Article</span>
          <span className="w-28">Quantité</span>
          <span className="w-32">Montant payé ({devise})</span>
        </div>
        {Array.from({ length: nbLignes }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <select name="articleId" defaultValue="" className={`${inp} min-w-64 flex-1`}>
              <option value="">— article —</option>
              {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
            </select>
            <input name="quantite" type="number" step="0.001" min="0" placeholder="Qté" className={`${inp} w-28`} />
            <input name="montant" type="number" step="0.01" min="0" placeholder={`Montant ${devise}`} className={`${inp} w-32`} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setNbLignes((n) => n + 1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider l'entrée en stock"}
        </button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
      </div>
      <p className="text-xs text-muted-foreground">Le montant est facultatif. En CDF, il est converti en USD au taux courant et enregistré sur le mouvement (utile pour l&apos;achat de légumes frais payés en francs).</p>
    </form>
  );
}
