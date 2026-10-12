import { redirect } from "next/navigation";
import { messageLisible } from "@/lib/erreur-metier";

// Pendant du lib/action-lisible pour les actions de FORMULAIRE (<form action={…}>) : leur
// valeur de retour étant ignorée par le navigateur, l'erreur métier doit revenir par la page —
// en prod, Next masque le message des erreurs jetées (page d'erreur générique).

function estRedirectionNext(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(String((e as { digest?: unknown }).digest))
  );
}

/**
 * Exécute le corps d'une action de formulaire ; toute erreur redirige vers `page`
 * avec `?erreur=<message lisible>` (à afficher par la page). Les redirections de succès
 * internes au corps passent inchangées.
 */
export async function formulaireLisible(page: string, corps: () => Promise<void>): Promise<void> {
  let message: string | null = null;
  try {
    await corps();
  } catch (e) {
    if (estRedirectionNext(e)) throw e;
    // Erreur métier : son message ; sinon message générique + journal (src/lib/erreur-metier.ts).
    message = messageLisible(e, `formulaire ${page}`);
  }
  if (message) redirect(`${page}${page.includes("?") ? "&" : "?"}erreur=${encodeURIComponent(message)}`);
}
