"use client";

import { useState, useTransition } from "react";
import { importerBonsCommandePDF } from "./actions";
import { estErreur } from "@/lib/action-lisible";

type Res = Exclude<Awaited<ReturnType<typeof importerBonsCommandePDF>>, { erreur: string }>;

export function ImportBonsCommandeBtn() {
  const [ouvert, setOuvert] = useState(false);
  const [isPending, start] = useTransition();
  const [res, setRes] = useState<Res | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = (fd: FormData) => {
    setRes(null); setErreur(null);
    start(async () => {
      const r = await importerBonsCommandePDF(fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setRes(r);
    });
  };

  return (
    <div className="relative inline-block">
      <button onClick={() => setOuvert((o) => !o)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Importer PDF ▾</button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <div className="absolute right-0 z-50 mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-card p-4 shadow-xl">
            <p className="text-sm font-semibold">Importer des bons de commande (PDF)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF de bons de commande (texte). Numéro, fournisseur, date et total sont extraits ;
              le PDF d&apos;origine est joint. Fournisseurs manquants créés, doublons ignorés.
            </p>
            <form action={envoyer} className="mt-3 space-y-2">
              <input type="file" name="fichiers" accept="application/pdf,.pdf" multiple required className="w-full text-xs" />
              <button disabled={isPending} className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {isPending ? "Import en cours…" : "Importer"}
              </button>
            </form>
            {erreur && <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{erreur}</p>}
            {res && (
              <div className="mt-2 space-y-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <p><b>{res.importes}</b> bon(s) importé(s){res.ignores > 0 ? ` · ${res.ignores} ignoré(s)` : ""}.</p>
                {res.fournisseursCrees.length > 0 && <p>Fournisseurs créés : {res.fournisseursCrees.join(", ")}.</p>}
                {res.erreurs.length > 0 && <p className="text-amber-800">Alertes : {res.erreurs.join(" · ")}</p>}
                {res.importes > 0 && <p className="text-muted-foreground">Rechargez la page pour les voir.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
