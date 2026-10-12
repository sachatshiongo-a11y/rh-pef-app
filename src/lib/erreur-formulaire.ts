import { redirect } from "next/navigation";
import { messageLisible } from "@/lib/erreur-metier";

// Pendant du lib/action-lisible pour les actions de FORMULAIRE (<form action={…}>) : leur
// valeur de retour étant ignorée par le navigateur, l'erreur métier doit revenir par la page —
// en prod, Next masque le message des erreurs jetées (page d'erreur générique).

/**
 * Champ ajouté à l'envoi par `FormulaireGarde` (components/formulaire-garde.tsx) : « je lis la
 * réponse, rends-moi le refus comme valeur ». Une action qui redirige vers `?erreur=` fait remonter
 * l'arbre (RedirectBoundary de Next remonte tout le sous-arbre : la saisie en cours disparaît) ;
 * rendue comme valeur `{ erreur }`, le refus s'affiche sans rien démonter et la saisie reste.
 * Sans ce champ (formulaire sans JavaScript, appel direct), le comportement historique est inchangé.
 */
export const CHAMP_RETOUR_ERREUR = "__retour_erreur";

function estRedirectionNext(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(String((e as { digest?: unknown }).digest))
  );
}

/** Message d'une redirection `…?erreur=<message>` jetée par le corps d'une action (refus explicite), sinon null. */
function erreurDeRedirection(e: unknown): string | null {
  const digest = String((e as { digest?: unknown })?.digest ?? "");
  if (!digest.startsWith("NEXT_REDIRECT")) return null;
  // digest = « NEXT_REDIRECT;<type>;<url>;<statut>; » — l'URL peut contenir « ; » encodé en %3B, jamais brut.
  const url = digest.split(";")[2] ?? "";
  const requete = url.split("?")[1];
  if (!requete) return null;
  const message = new URLSearchParams(requete).get("erreur");
  return message && message.length > 0 ? message : null;
}

/**
 * Exécute le corps d'une action de formulaire ; toute erreur redirige vers `page`
 * avec `?erreur=<message lisible>` (à afficher par la page). Les redirections de succès
 * internes au corps passent inchangées.
 *
 * Avec `formData` portant `CHAMP_RETOUR_ERREUR`, le refus (erreur levée OU redirection explicite vers
 * `?erreur=`) est RENDU comme `{ erreur }` au lieu de rediriger — l'écran appelant garde sa saisie.
 */
export function formulaireLisible(page: string, corps: () => Promise<void>): Promise<void>;
export function formulaireLisible(page: string, corps: () => Promise<void>, formData: FormData): Promise<{ erreur: string } | void>;
export async function formulaireLisible(page: string, corps: () => Promise<void>, formData?: FormData): Promise<{ erreur: string } | void> {
  const retour = formData?.get(CHAMP_RETOUR_ERREUR) === "1";
  let message: string | null = null;
  try {
    await corps();
  } catch (e) {
    if (estRedirectionNext(e)) {
      const refus = retour ? erreurDeRedirection(e) : null;
      if (refus === null) throw e;
      return { erreur: refus };
    }
    // Erreur métier : son message ; sinon message générique + journal (src/lib/erreur-metier.ts).
    message = messageLisible(e, `formulaire ${page}`);
  }
  if (message) {
    if (retour) return { erreur: message };
    redirect(`${page}${page.includes("?") ? "&" : "?"}erreur=${encodeURIComponent(message)}`);
  }
}
