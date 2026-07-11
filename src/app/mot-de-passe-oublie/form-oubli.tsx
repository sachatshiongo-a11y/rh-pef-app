"use client";

import { useActionState } from "react";
import { demanderReinitialisation } from "@/app/login/actions";

export function FormOubli() {
  const [state, action, pending] = useActionState(demanderReinitialisation, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.ok}</p>}
      <button type="submit" disabled={pending || !!state?.ok}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {pending ? "Envoi…" : "Envoyer le lien"}
      </button>
    </form>
  );
}
