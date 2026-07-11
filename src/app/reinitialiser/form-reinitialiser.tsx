"use client";

import { useActionState, useState } from "react";
import { reinitialiserMotDePasse } from "@/app/login/actions";

export function FormReinitialiser({ token }: { token: string }) {
  const [state, action, pending] = useActionState(reinitialiserMotDePasse, undefined);
  const [visible, setVisible] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">Nouveau mot de passe</label>
        <div className="relative">
          <input id="password" name="password" type={visible ? "text" : "password"} required minLength={8} autoComplete="new-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 pr-16 text-sm outline-none focus:ring-2 focus:ring-ring" />
          <button type="button" onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="absolute inset-y-0 right-0 rounded-r-md px-3 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {visible ? "Masquer" : "Afficher"}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmation" className="text-sm font-medium">Confirmez le mot de passe</label>
        <input id="confirmation" name="confirmation" type={visible ? "text" : "password"} required minLength={8} autoComplete="new-password"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <button type="submit" disabled={pending}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {pending ? "Enregistrement…" : "Changer le mot de passe"}
      </button>
    </form>
  );
}
