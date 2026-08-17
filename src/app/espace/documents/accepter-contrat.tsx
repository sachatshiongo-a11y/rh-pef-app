"use client";

import { useTransition } from "react";
import { accepterMonContrat } from "../actions";

/** Bouton d'acceptation numérique du contrat (« Lu et approuvé », horodatée). */
export function AccepterContrat({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => { if (confirm("En cliquant, vous confirmez avoir lu et approuvé ce contrat. Cette acceptation est horodatée.")) start(async () => { await accepterMonContrat(id); }); }}
      className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      Lu et approuvé
    </button>
  );
}
