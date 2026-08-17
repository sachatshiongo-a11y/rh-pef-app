"use client";

import { useState, useTransition } from "react";
import { supprimerMouvement } from "../mouvements/actions";
import { estErreur } from "@/lib/action-lisible";

/** Retire un achat de l'historique de la liste d'achat (Direction) — l'effet sur le stock est annulé. */
export function SupprimerAchatBtn({ mouvementId, designation }: { mouvementId: string; designation: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {erreur && <span className="text-xs text-destructive">{erreur}</span>}
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`Supprimer cet achat (${designation}) ? Le stock sera corrigé (effet annulé).`)) return;
          setErreur(null);
          start(async () => {
            const r = await supprimerMouvement(mouvementId);
            if (estErreur(r)) setErreur(r.erreur);
          });
        }}
        aria-label={`Supprimer l'achat ${designation}`}
        title="Supprimer cet achat (le stock sera corrigé)"
        className="rounded-md border px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        ✕
      </button>
    </span>
  );
}
