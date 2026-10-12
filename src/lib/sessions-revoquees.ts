/**
 * RÉVOCATION DES SESSIONS (audit du 10/10/2026, sécurité 5).
 *
 * Le défaut : réinitialiser le mot de passe d'un compte, ou le désactiver, laissait ses sessions
 * ouvertes (un téléphone volé restait connecté), et un compte désactivé tournait en boucle entre
 * /login (le proxy le voit connecté → /entree) et /entree (verifySession le voit inactif → /login).
 *
 * Pourquoi pas l'API d'administration de Supabase : la clé de service est bien disponible côté
 * serveur (SUPABASE_SERVICE_ROLE_KEY), mais GoTrue n'offre AUCUNE route « fermer toutes les sessions
 * de l'utilisateur X » — `auth.admin.signOut` exige le jeton de la session à fermer, que le serveur
 * n'a pas. Et le jeton d'accès se vérifie LOCALEMENT (getClaims, signature ES256) : même une session
 * supprimée côté Supabase resterait acceptée jusqu'à son expiration (~1 h).
 *
 * La règle : `User.sessionsRevoqueesLe` est posé à l'instant de la réinitialisation / désactivation ;
 * toute session AUTHENTIFIÉE AVANT cet instant est refusée par verifySession. L'instant
 * d'authentification se lit dans le jeton (`amr[].timestamp`, l'heure de la connexion par mot de
 * passe) : il NE CHANGE PAS quand le jeton est rafraîchi, si bien qu'un rafraîchissement ne
 * « blanchit » pas une session révoquée. Une nouvelle connexion, elle, porte un instant postérieur.
 *
 * Module PUR : ni session, ni base.
 */

/** Motif porté par la redirection vers /login : le proxy efface alors les cookies de session au lieu de renvoyer vers /entree (fin de la boucle). */
export const MOTIF_SESSION_FERMEE = "session-fermee";

type Claims = { iat?: number; amr?: { method?: string; timestamp?: number }[] | unknown } | null | undefined;

/** Instant (secondes Unix) de la connexion qui a ouvert la session ; `iat` à défaut d'`amr`. */
export function instantAuthentification(claims: Claims): number | null {
  if (!claims) return null;
  const amr = Array.isArray(claims.amr) ? (claims.amr as { timestamp?: unknown }[]) : [];
  const instants = amr.map((a) => a?.timestamp).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (instants.length) return Math.max(...instants);
  return typeof claims.iat === "number" ? claims.iat : null;
}

/**
 * Vrai si la session a été ouverte AVANT la révocation. L'instant du jeton est à la seconde : on
 * compare à la seconde entière de la révocation, pour qu'une connexion faite dans la même seconde
 * (rarissime) ne soit pas refusée à tort. Instant illisible → révoquée (prudence) dès qu'une
 * révocation existe.
 */
export function sessionRevoquee(claims: Claims, revoqueesLe: Date | null | undefined): boolean {
  if (!revoqueesLe) return false;
  const t = instantAuthentification(claims);
  if (t === null) return true;
  return t < Math.floor(revoqueesLe.getTime() / 1000);
}

/** Données à écrire sur le `User` pour fermer toutes ses sessions ouvertes. */
export function donneesRevocationSessions(maintenant: Date = new Date()): { sessionsRevoqueesLe: Date } {
  return { sessionsRevoqueesLe: maintenant };
}
