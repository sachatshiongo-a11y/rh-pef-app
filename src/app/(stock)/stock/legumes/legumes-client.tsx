"use client";

import { useState, useTransition } from "react";
import { creerAchatsLegumes, supprimerAchatLegume } from "./actions";
import { LEGUMES } from "./legumes-data";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";

type Ligne = { legume: string; unite: string; quantite: string; montantCDF: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const vide = (): Ligne => ({ legume: "", unite: "", quantite: "", montantCDF: "" });

export function AchatLegumesForm({ taux, estDirection = false }: { taux: number; estDirection?: boolean }) {
  const [isPending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([vide(), vide(), vide()]);
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); setLignes([vide(), vide(), vide()]); setCle((c) => c + 1); };

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const choisir = (i: number, nom: string) => {
    const l = LEGUMES.find((x) => x.nom === nom);
    maj(i, { legume: nom, unite: l?.unite ?? "" });
  };
  const totalCDF = lignes.reduce((t, l) => t + (Number(l.montantCDF) || 0), 0);
  const totalUSD = taux ? totalCDF / taux : 0;

  const submit = (fd: FormData) => {
    setMsg(null);
    start(async () => {
      try { await creerAchatsLegumes(fd); setMsg({ ok: true, t: "Achats enregistrés." }); setLignes([vide(), vide(), vide()]); setCle((c) => c + 1); }
      catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  return (
    <form key={cle} action={submit} className="space-y-3 rounded-lg border p-4">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.t}</p>}
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Date</span>
        <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inp} />
        <span className="ml-auto text-xs text-muted-foreground">Taux : 1 USD = {taux ? taux.toLocaleString("fr-FR") : "—"} CDF</span>
      </label>

      {/* Une seule mise en page responsive : empilée sur mobile, en ligne sur ordinateur. */}
      <div className="space-y-2">
        <div className="hidden gap-2 px-1 text-xs text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem_4rem]">
          <span>Légume</span><span>Unité</span><span className="text-right">Quantité</span><span className="text-right">Montant CDF</span><span className="text-right">≈ USD</span>
        </div>
        {lignes.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem_4rem] sm:items-center sm:rounded-none sm:border-0 sm:p-0">
            <div className="col-span-2 sm:col-span-1">
              <select value={l.legume} onChange={(e) => choisir(i, e.target.value)} className={`${inp} w-full min-w-0`}>
                <option value="">— légume —</option>
                {LEGUMES.map((x) => <option key={x.nom} value={x.nom}>{x.nom}</option>)}
              </select>
              <input type="hidden" name="legume" value={l.legume} />
            </div>
            <input name="unite" value={l.unite} onChange={(e) => maj(i, { unite: e.target.value })} placeholder="Unité" className={`${inp} min-w-0`} />
            <input name="quantite" value={l.quantite} onChange={(e) => maj(i, { quantite: e.target.value })} type="number" step="0.001" min="0" placeholder="Quantité" className={`${inp} min-w-0 text-right`} />
            <input name="montantCDF" value={l.montantCDF} onChange={(e) => maj(i, { montantCDF: e.target.value })} type="number" step="1" min="0" placeholder="Montant CDF" className={`${inp} min-w-0 text-right`} />
            <span className="self-center text-right text-xs text-muted-foreground">≈ {taux && Number(l.montantCDF) ? (Number(l.montantCDF) / taux).toFixed(2) : "0.00"} $</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setLignes((ls) => [...ls, vide()])} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <div className="text-right text-sm">
          <span className="text-muted-foreground">Total : </span>
          <span className="font-semibold">{totalCDF.toLocaleString("fr-FR")} CDF</span>
          <span className="text-muted-foreground"> ≈ {totalUSD.toFixed(2)} $</span>
        </div>
        <div className="flex items-center gap-2">
          <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
          <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Enregistrer les achats"}</button>
        </div>
      </div>
    </form>
  );
}

export function SupprimerAchatBtn({ id }: { id: string }) {
  const [isPending, start] = useTransition();
  return (
    <button onClick={() => { if (confirm("Supprimer cette ligne ?")) start(() => supprimerAchatLegume(id)); }} disabled={isPending} className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">✕</button>
  );
}
