"use client";

import { useState, useTransition } from "react";
import { appliquerComptage } from "./actions";
import { qte } from "@/lib/stock";

type Art = { id: string; designation: string; theorique: number };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function ReconciliationForm({ articles }: { articles: Art[] }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await appliquerComptage(fd); setMsg({ ok: true, texte: "Comptage appliqué : le stock a été ajusté au réel." }); setVals({}); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };
  const ecart = (a: Art) => { const v = vals[a.id]; if (v === undefined || v === "") return null; const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n - a.theorique : null; };
  const nbSaisis = Object.values(vals).filter((v) => v !== "").length;

  return (
    <form action={submit} className="space-y-3">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input name="origine" placeholder="Libellé du comptage (ex. Inventaire fin de mois)" className={`${inp} min-w-64 flex-1`} />
        <span className="text-sm text-muted-foreground">{nbSaisis} article(s) compté(s)</span>
        <button disabled={isPending || nbSaisis === 0} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Application…" : "Appliquer le comptage"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Article</th>
              <th className="px-3 py-2 text-right">Théorique</th>
              <th className="px-3 py-2 text-right">Physique</th>
              <th className="px-3 py-2 text-right">Écart</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => {
              const e = ecart(a);
              return (
                <tr key={a.id} className="border-t hover:bg-accent/40 even:bg-muted/25">
                  <td className="px-3 py-1.5 font-medium">{a.designation}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{qte(a.theorique)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input type="hidden" name="recon_articleId" value={a.id} />
                    <input name="recon_physique" type="number" step="0.001" value={vals[a.id] ?? ""} onChange={(ev) => setVals((s) => ({ ...s, [a.id]: ev.target.value }))} className={`${inp} w-24 text-right`} />
                  </td>
                  <td className={`px-3 py-1.5 text-right font-medium ${e === null ? "text-muted-foreground" : e === 0 ? "text-emerald-700" : e > 0 ? "text-blue-700" : "text-red-700"}`}>
                    {e === null ? "—" : `${e > 0 ? "+" : ""}${qte(e)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
