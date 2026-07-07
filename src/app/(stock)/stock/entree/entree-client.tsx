"use client";

import { useState, useTransition } from "react";
import { entreeListeAchat } from "./actions";

type Art = { id: string; designation: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function ListeAchatForm({ articles }: { articles: Art[] }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [nbLignes, setNbLignes] = useState(4);

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try {
        await entreeListeAchat(fd);
        setMsg({ ok: true, texte: "Entrées enregistrées : le stock a été mis à jour." });
        setNbLignes(4);
      } catch (e) {
        setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." });
      }
    });
  };

  return (
    <form action={submit} className="space-y-3">
      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.texte}
        </p>
      )}

      <label className="flex max-w-md flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Origine / libellé (optionnel)</span>
        <input name="origine" placeholder="Liste d'achat semaine…" className={inp} />
      </label>

      <div className="space-y-2">
        {Array.from({ length: nbLignes }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <select name="articleId" defaultValue="" className={`${inp} min-w-64 flex-1`}>
              <option value="">— article —</option>
              {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
            </select>
            <input name="quantite" type="number" step="0.001" min="0" placeholder="Qté" className={`${inp} w-28`} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setNbLignes((n) => n + 1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider l'entrée en stock"}
        </button>
      </div>
    </form>
  );
}
