/**
 * Services Web Push ACCEPTÉS (audit du 10/10/2026, sécurité 7).
 *
 * L'adresse d'un abonnement (`endpoint`) est fournie par le navigateur — donc par n'importe qui :
 * sans contrôle, un compte connecté pouvait enregistrer une adresse de son choix (réseau interne
 * de l'hébergeur, service tiers) et faire envoyer par le serveur des requêtes vers elle à chaque
 * notification (SSRF « aveugle »). Seuls les services push des navigateurs sont acceptés :
 *   - Google FCM (Chrome, Edge sur Android, Samsung…) : fcm.googleapis.com
 *   - Apple (Safari, PWA iOS/macOS) : *.push.apple.com
 *   - Mozilla (Firefox) : *.push.services.mozilla.com
 *   - Microsoft WNS (Edge sous Windows) : *.notify.windows.com
 * En HTTPS, sur le port par défaut, sans identifiants dans l'adresse. Module PUR.
 */
const DOMAINES_PUSH = ["fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"] as const;

export function endpointPushAutorise(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return false;
  const hote = u.hostname.toLowerCase();
  return DOMAINES_PUSH.some((d) => hote === d || hote.endsWith(`.${d}`));
}

export const MESSAGE_PUSH_SERVICE_INCONNU = "Service de notification non reconnu : abonnement refusé.";
