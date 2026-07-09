"use client";

import { useState, useTransition } from "react";
import { marquerPayee } from "../actions";

export function MarquerPayeeBtn({ id }: { id: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <>
      <button
        onClick={() => start(async () => { setErreur(null); try { await marquerPayee(id); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } })}
        disabled={isPending}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
      >
        {isPending ? "…" : "✓ Marquer payée"}
      </button>
      {erreur && <span className="text-xs text-destructive">{erreur}</span>}
    </>
  );
}
