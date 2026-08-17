"use client";

import { useEffect } from "react";

/** UI d'erreur récupérable (boundary) : évite l'écran « This page couldn't load » de la PWA en
 *  proposant Réessayer / retour, et affiche le message quand il est disponible. */
export function ErrorRetry({ error, reset, accueilHref = "/accueil" }: {
  error: Error & { digest?: string };
  reset: () => void;
  accueilHref?: string;
}) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="text-4xl" aria-hidden>⚠️</div>
      <h1 className="text-lg font-semibold">Une erreur est survenue</h1>
      <p className="text-sm text-muted-foreground">
        {error?.message && !/^An error occurred/i.test(error.message) ? error.message : "L’action n’a pas pu aboutir. Réessayez ; si le problème persiste, contactez la direction."}
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={() => reset()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Réessayer</button>
        <a href={accueilHref} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Accueil</a>
      </div>
      {error?.digest && <p className="text-[11px] text-muted-foreground">Réf. {error.digest}</p>}
    </div>
  );
}
