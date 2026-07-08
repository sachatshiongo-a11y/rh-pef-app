"use client";

import { useState, useTransition } from "react";
import { mouvementManuel, supprimerMouvement } from "./actions";

type Art = { id: string; designation: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function SupprimerMouvementBtn({ id }: { id: string }) {
  const [isPending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      title="Supprimer ce mouvement (annule son effet sur le stock)"
      onClick={() => { if (confirm("Supprimer ce mouvement ? Son effet sur le stock sera annulé.")) start(() => supprimerMouvement(id)); }}
      className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
    >
      ✕
    </button>
  );
}

export function MouvementForm({ articles }: { articles: Art[] }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [nb, setNb] = useState(3);
  const [type, setType] = useState<"ENTREE" | "SORTIE">("ENTREE");
  const [ouvert, setOuvert] = useState(false);

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await mouvementManuel(fd); setMsg({ ok: true, texte: type === "ENTREE" ? "Entrée enregistrée : stock incrémenté." : "Sortie enregistrée : stock décrémenté." }); setNb(3); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  if (!ouvert) return <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">± Mouvement manuel (entrée / sortie)</button>;

  return (
    <form action={submit} className="space-y-2 rounded-lg border p-4">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => setType("ENTREE")} className={`px-3 py-1.5 ${type === "ENTREE" ? "bg-emerald-600 text-white" : "hover:bg-accent"}`}>Entrée</button>
          <button type="button" onClick={() => setType("SORTIE")} className={`px-3 py-1.5 ${type === "SORTIE" ? "bg-red-600 text-white" : "hover:bg-accent"}`}>Sortie</button>
        </div>
        <input type="hidden" name="type" value={type} />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Date<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inp} /></label>
        <input name="origine" placeholder={type === "ENTREE" ? "Motif (achat direct, don…)" : "Motif (consommation, casse…)"} className={`${inp} min-w-56 flex-1`} />
      </div>

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
        <button disabled={isPending} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${type === "ENTREE" ? "bg-emerald-600" : "bg-red-600"}`}>{isPending ? "Enregistrement…" : type === "ENTREE" ? "Valider l'entrée" : "Valider la sortie"}</button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
    </form>
  );
}
