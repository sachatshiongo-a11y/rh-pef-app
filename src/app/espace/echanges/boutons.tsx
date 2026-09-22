"use client";

import { useTransition } from "react";
import { repondreEchange, annulerEchange, annulerChangement } from "../actions";
import { BoutonApprouver, BoutonRefuser } from "@/components/action-buttons";

export function RepondreEchange({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 gap-2">
      <BoutonApprouver disabled={pending} onClick={() => start(async () => { await repondreEchange(id, true); })}>Accepter</BoutonApprouver>
      <BoutonRefuser disabled={pending} onClick={() => start(async () => { await repondreEchange(id, false); })} />
    </span>
  );
}

export function AnnulerEchange({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => { if (confirm("Annuler cette demande ?")) start(async () => { await annulerEchange(id); }); }}
      className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50">Annuler</button>
  );
}

export function AnnulerChangement({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => { if (confirm("Annuler cette demande ?")) start(async () => { await annulerChangement(id); }); }}
      className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50">Annuler</button>
  );
}
