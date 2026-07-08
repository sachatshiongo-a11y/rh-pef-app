"use client";

import { useState, useTransition } from "react";
import { appliquerComptage } from "./actions";
import { qte } from "@/lib/stock";

type Art = { id: string; designation: string; theorique: number };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

// Ligne indépendante : son propre état → taper dans une ligne ne re-rend QUE cette ligne
// (évite le ralentissement quand la page en affiche plusieurs centaines).
function LigneComptage({ a }: { a: Art }) {
  const [v, setV] = useState("");
  const ecart = v === "" || !Number.isFinite(Number(v.replace(",", "."))) ? null : Number(v.replace(",", ".")) - a.theorique;
  return (
    <tr className="border-t even:bg-muted/25 hover:bg-accent/40">
      <td className="px-3 py-1.5 font-medium">{a.designation}</td>
      <td className="px-3 py-1.5 text-right text-muted-foreground">{qte(a.theorique)}</td>
      <td className="px-3 py-1.5 text-right">
        <input type="hidden" name="recon_articleId" value={a.id} />
        <input name="recon_physique" type="number" step="0.001" value={v} onChange={(e) => setV(e.target.value)} className={`${inp} w-24 text-right`} />
      </td>
      <td className={`px-3 py-1.5 text-right font-medium ${ecart === null ? "text-muted-foreground" : ecart === 0 ? "text-emerald-700" : ecart > 0 ? "text-blue-700" : "text-red-700"}`}>
        {ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${qte(ecart)}`}
      </td>
    </tr>
  );
}

export function ReconciliationForm({ articles }: { articles: Art[] }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await appliquerComptage(fd); setMsg({ ok: true, texte: "Comptage appliqué : le stock a été ajusté au réel." }); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  return (
    <form action={submit} className="space-y-3">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input name="origine" placeholder="Libellé du comptage (ex. Inventaire fin de mois)" className={`${inp} min-w-64 flex-1`} />
        <span className="text-xs text-muted-foreground">{articles.length} article(s) à compter · ne saisissez que ce que vous comptez</span>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Application…" : "Appliquer le comptage"}
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th>Article</th>
              <th className="!text-right">Théorique</th>
              <th className="!text-right">Physique</th>
              <th className="!text-right">Écart</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => <LigneComptage key={a.id} a={a} />)}
          </tbody>
        </table>
      </div>
    </form>
  );
}
