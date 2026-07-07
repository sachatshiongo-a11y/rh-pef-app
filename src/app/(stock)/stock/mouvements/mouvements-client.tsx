"use client";

import { useState, useTransition } from "react";
import { sortieStock } from "./actions";

type Art = { id: string; designation: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function SortieForm({ articles }: { articles: Art[] }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [nb, setNb] = useState(3);
  const [ouvert, setOuvert] = useState(false);

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await sortieStock(fd); setMsg({ ok: true, texte: "Sortie enregistrée : le stock a été décrémenté." }); setNb(3); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  if (!ouvert) return <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">− Enregistrer une sortie</button>;

  return (
    <form action={submit} className="space-y-2 rounded-lg border p-4">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}
      <label className="flex max-w-md flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Motif / origine (optionnel)</span>
        <input name="origine" placeholder="Consommation cuisine, casse…" className={inp} />
      </label>
      {Array.from({ length: nb }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <select name="articleId" defaultValue="" className={`${inp} min-w-64 flex-1`}>
            <option value="">— article —</option>
            {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
          </select>
          <input name="quantite" type="number" step="0.001" min="0" placeholder="Qté" className={`${inp} w-28`} />
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => setNb((n) => n + 1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Valider la sortie"}</button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
    </form>
  );
}
