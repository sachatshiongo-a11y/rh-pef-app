"use client";

import { useState, useTransition } from "react";
import { annulerImportAction } from "./actions";
import { estErreur } from "@/lib/action-lisible";

export function BoutonAnnulerImport({ batchId, libelle }: { batchId: string; libelle: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const annuler = () => {
    if (!confirm(`Annuler l'import « ${libelle} » ?\n\nLes articles créés seront supprimés et les stocks/prix modifiés restaurés à leur valeur précédente. Les mouvements et achats de cet import seront retirés.`)) return;
    setErreur(null);
    start(async () => {
      const r = await annulerImportAction(batchId);
      if (estErreur(r)) setErreur(r.erreur);
    });
  };
  return (
    <div className="text-right">
      <button onClick={annuler} disabled={isPending} className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">{isPending ? "Annulation…" : "Annuler cet import"}</button>
      {erreur && <p className="mt-1 text-xs text-destructive">{erreur}</p>}
    </div>
  );
}
