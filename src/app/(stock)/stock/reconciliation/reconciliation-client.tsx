"use client";

import { useState, useTransition } from "react";
import { appliquerComptage } from "./actions";
import { qte, SEUIL_TOLERANCE_PCT } from "@/lib/stock";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";

type Art = { id: string; designation: string; theorique: number };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

// Ligne indépendante : son propre état → taper dans une ligne ne re-rend QUE cette ligne
// (évite le ralentissement quand la page en affiche plusieurs centaines).
function LigneComptage({ a }: { a: Art }) {
  const [v, setV] = useState("");
  const [expl, setExpl] = useState("");
  const num = Number(v.replace(",", "."));
  const valide = v !== "" && Number.isFinite(num);
  const ecart = valide ? num - a.theorique : null;
  const pct = ecart === null ? null : a.theorique !== 0 ? (ecart / Math.abs(a.theorique)) * 100 : ecart !== 0 ? 100 : 0;
  const horsTol = ecart !== null && Math.abs(ecart) > 0.0001 && (a.theorique === 0 ? num !== 0 : Math.abs(pct!) > SEUIL_TOLERANCE_PCT);
  const couleurEcart = ecart === null ? "text-muted-foreground" : ecart === 0 ? "text-emerald-700" : horsTol ? "text-red-700" : ecart > 0 ? "text-blue-700" : "text-amber-700";
  return (
    <div className={`border-t px-3 py-2 even:bg-muted/25 hover:bg-accent/40 sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem] sm:items-center sm:gap-2 sm:py-1.5 ${horsTol ? "bg-red-50/50" : ""}`}>
      <div className="font-medium">{a.designation}</div>
      <div className="mt-1 flex items-center justify-between sm:mt-0 sm:block sm:text-right">
        <span className="text-xs text-muted-foreground sm:hidden">Théorique</span>
        <span className="tabular-nums text-muted-foreground">{qte(a.theorique)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 sm:mt-0 sm:justify-end">
        <span className="text-xs text-muted-foreground sm:hidden">Physique compté</span>
        <input type="hidden" name="recon_articleId" value={a.id} />
        <input name="recon_physique" type="number" step="0.001" value={v} onChange={(e) => setV(e.target.value)} placeholder="0" className={`${inp} w-28 text-right`} />
      </div>
      <div className={`mt-1 flex items-center justify-between font-medium tabular-nums sm:mt-0 sm:justify-end ${couleurEcart}`}>
        <span className="text-xs font-normal text-muted-foreground sm:hidden">Écart</span>
        <span>{ecart === null ? "—" : <>{ecart > 0 ? "+" : ""}{qte(ecart)}{pct !== null && a.theorique !== 0 ? <span className="ml-1 text-xs">({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)</span> : null}</>}</span>
        {!horsTol && <input type="hidden" name="recon_explication" value="" />}
      </div>
      {/* Explication requise si écart > seuil de tolérance. */}
      {horsTol && (
        <div className="mt-2 sm:col-span-4">
          <input name="recon_explication" value={expl} onChange={(e) => setExpl(e.target.value)} required placeholder={`Écart > ${SEUIL_TOLERANCE_PCT} % — expliquez la raison (obligatoire)`} className={`${inp} w-full border-red-300`} />
        </div>
      )}
    </div>
  );
}

export function ReconciliationForm({ articles, domaine, estDirection = false }: { articles: Art[]; domaine?: string; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); setCle((c) => c + 1); };

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await appliquerComptage(fd); setMsg({ ok: true, texte: "Comptage appliqué : le stock a été ajusté au réel." }); setCle((c) => c + 1); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  return (
    <form key={cle} action={submit} className="space-y-3">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}
      {domaine && <input type="hidden" name="domaine" value={domaine} />}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <input name="origine" placeholder="Libellé du comptage (ex. Inventaire fin de mois)" className={`${inp} w-full sm:w-auto sm:min-w-64 sm:flex-1`} />
        <span className="text-xs text-muted-foreground">{articles.length} article(s) · écart &gt; {SEUIL_TOLERANCE_PCT}% ⇒ explication requise · fiche archivée</span>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Application…" : "Appliquer le comptage"}
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border text-sm">
        <div className="sticky top-0 z-10 hidden gap-2 border-b bg-muted px-3 py-2 font-semibold shadow-sm sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem]">
          <span>Article</span>
          <span className="text-right">Théorique</span>
          <span className="text-right">Physique</span>
          <span className="text-right">Écart</span>
        </div>
        {articles.map((a) => <LigneComptage key={a.id} a={a} />)}
        {articles.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">Aucun article.</p>}
      </div>
    </form>
  );
}
