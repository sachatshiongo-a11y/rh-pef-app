"use client";

import { useRef, useState, useTransition } from "react";
import { importerFacturesExcel } from "./actions";

type Res = Awaited<ReturnType<typeof importerFacturesExcel>>;

export function ImportFacturesBtn() {
  const [ouvert, setOuvert] = useState(false);
  const [isPending, start] = useTransition();
  const [res, setRes] = useState<Res | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const envoyer = (fd: FormData) => {
    setRes(null); setErreur(null);
    start(async () => {
      try { setRes(await importerFacturesExcel(fd)); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur pendant l'import."); }
    });
  };

  return (
    <div className="relative inline-block">
      <button onClick={() => setOuvert((o) => !o)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Importer ▾</button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <div className="absolute right-0 z-50 mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-card p-4 shadow-xl">
            <p className="text-sm font-semibold">Importer des factures</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Classeur Excel « Suivi des factures fournisseurs » (.xlsx). Les fournisseurs manquants
              sont créés, les doublons ignorés. Montants en francs (≥ 10 000) convertis en USD.
            </p>
            <form action={envoyer} className="mt-3 space-y-2">
              <input ref={ref} type="file" name="fichiers" accept=".xlsx,.xls" multiple required className="w-full text-xs" />
              <button disabled={isPending} className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {isPending ? "Import en cours…" : "Importer"}
              </button>
            </form>

            {erreur && <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{erreur}</p>}
            {res && (
              <div className="mt-2 space-y-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <p><b>{res.importees}</b> facture(s) importée(s){res.ignorees > 0 ? ` · ${res.ignorees} doublon(s) ignoré(s)` : ""}.</p>
                {res.fournisseursCrees.length > 0 && <p>Fournisseurs créés : {res.fournisseursCrees.join(", ")}.</p>}
                {res.erreurs.length > 0 && <p className="text-amber-800">Alertes : {res.erreurs.join(" · ")}</p>}
                {res.importees > 0 && <p className="text-muted-foreground">Rechargez la page pour voir les nouvelles factures.</p>}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Les bons de commande scannés (PDF images) ne sont pas importables automatiquement.</p>
          </div>
        </>
      )}
    </div>
  );
}
