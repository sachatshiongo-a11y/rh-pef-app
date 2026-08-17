// En production, Next.js masque le message des erreurs jetées par une action serveur
// (l'utilisateur voit « An error occurred… » au lieu de « Le montant dépasse le reste à payer »).
// `actionLisible` enrobe une action : l'erreur métier revient au client comme { erreur: string },
// à afficher telle quelle. Les redirections internes de Next (redirect/notFound) passent inchangées.

type ErreurAction = { erreur: string };

function estRedirectionNext(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(String((e as { digest?: unknown }).digest))
  );
}

export function messageDe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Erreur inattendue. Réessayez.";
}

export function actionLisible<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R | ErreurAction> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (estRedirectionNext(e)) throw e;
      return { erreur: messageDe(e) };
    }
  };
}

/** Côté client : vrai si le résultat d'une action enrobée est une erreur métier. */
export function estErreur(r: unknown): r is ErreurAction {
  return typeof r === "object" && r !== null && "erreur" in r && typeof (r as ErreurAction).erreur === "string";
}
