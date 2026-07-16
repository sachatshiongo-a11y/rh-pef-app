"use client";

import { useTransition } from "react";
import { publierSemaine, depublierSemaine } from "./actions";

/** Bouton Publier / Dépublier une semaine — visible seulement si l'espace salarié est activé. */
export function PublierSemaineBtn({ lundiIso, publiee }: { lundiIso: string; publiee: boolean }) {
  const [isPending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => start(async () => { publiee ? await depublierSemaine(lundiIso) : await publierSemaine(lundiIso); })}
      title={publiee ? "Cette semaine est visible par les salariés. Cliquez pour la masquer." : "Rendre cette semaine visible par les salariés dans leur espace."}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        publiee ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "hover:bg-accent"
      }`}
    >
      {isPending ? "…" : publiee ? "✓ Publiée — masquer" : "Publier la semaine"}
    </button>
  );
}
