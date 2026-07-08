"use client";

import { useState, useTransition } from "react";

// Bouton « Supprimer tout » : suppression groupée de TOUTES les entrées d'une section.
// Rouge plein (action destructive), Direction uniquement, double confirmation.
export function BoutonSupprimerTout({ estDirection, action, libelle }: { estDirection: boolean; action: () => Promise<void>; libelle: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  if (!estDirection) return null;

  const cliquer = () => {
    if (!confirm(`${libelle}\n\nCette action est IRRÉVERSIBLE. Confirmer ?`)) return;
    if (!confirm("Dernière confirmation : supprimer définitivement ?")) return;
    setErreur(null);
    start(async () => { try { await action(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={cliquer} disabled={isPending} className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50">
        {isPending ? "Suppression…" : "Supprimer tout"}
      </button>
      {erreur && <span className="text-xs text-destructive">{erreur}</span>}
    </span>
  );
}
