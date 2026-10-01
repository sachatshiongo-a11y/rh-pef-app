import type { Role } from "@prisma/client";
import { estRH, estStock } from "@/lib/espaces";

/**
 * QUI PEUT TOUCHER UNE NOTIFICATION (la marquer lue, la supprimer) ET UN ABONNEMENT PUSH.
 *
 * Une Server Action est un point d'entrée HTTP à part entière : elle ne passe par AUCUN layout.
 * Jusqu'au 2026-09-28, `marquerNotificationsLues` et `supprimerNotification` n'exigeaient qu'une
 * session : un salarié pouvait vider la cloche de la Direction (congés, acomptes, échanges à
 * valider) sans rien voir, et `supprimerPush` désabonnait l'appareil de n'importe quel compte.
 *
 * Module PUR (ni session ni base) : les règles se testent sur la matrice complète des rôles.
 *
 *  - notification RH     → la RH, même règle que le layout RH (`estRH`) ; VIEWER compris, car la
 *                          cloche lui est affichée et son « lu » est partagé.
 *  - notification STOCK  → l'espace Stock, même règle que son layout (`estStock`).
 *  - notification RH/STOCK ADRESSÉE (`destinataireUserId` posé) → son seul destinataire, dans son espace.
 *  - notification SALARIE → son SEUL destinataire (`destinataireUserId`), quel que soit le rôle :
 *                          la Direction ne vide pas la cloche personnelle d'un salarié.
 *  - tout autre domaine  → personne.
 */
export type CompteNotification = { id: string; role: Role; accesStock?: boolean };

export const MESSAGE_NOTIFICATION_REFUSEE = "Cette notification n'est pas dans votre espace.";
export const MESSAGE_PUSH_REFUSE = "Cet appareil est abonné aux notifications d'un autre compte.";

/** Domaine d'une cloche d'espace (« Tout marquer lu ») que ce compte a le droit de gérer. */
export function peutGererDomaine(user: CompteNotification, domaine: string): boolean {
  if (domaine === "RH") return estRH(user.role);
  if (domaine === "STOCK") return estStock(user);
  return false;
}

/** Une notification précise, lue en base (domaine et destinataire réels, jamais ceux du client). */
export function peutToucherNotification(
  user: CompteNotification,
  n: { domaine: string; destinataireUserId: string | null },
): boolean {
  if (n.domaine === "SALARIE") return n.destinataireUserId !== null && n.destinataireUserId === user.id;
  // Notification d'espace ADRESSÉE à un compte (réponse à une demande de l'espace Stock) : à lui seul.
  if (n.destinataireUserId !== null) return n.destinataireUserId === user.id && peutGererDomaine(user, n.domaine);
  return peutGererDomaine(user, n.domaine);
}

/**
 * Un abonnement push se REPREND (enregistrement sur un endpoint déjà connu) seulement par son
 * propriétaire, ou par qui présente les MÊMES clés que l'abonnement enregistré : c'est la preuve
 * qu'il tient l'abonnement du navigateur lui-même (tablette partagée : le navigateur rend le même
 * abonnement au compte suivant, clés comprises). Qui ne connaît que l'endpoint est refusé.
 */
export function peutReprendreAbonnement(
  existant: { userId: string; p256dh: string; auth: string } | null,
  userId: string,
  cles: { p256dh: string; auth: string },
): boolean {
  if (!existant || existant.userId === userId) return true;
  return existant.p256dh === cles.p256dh && existant.auth === cles.auth;
}

/** Un abonnement push ne se SUPPRIME que par son propriétaire. */
export function abonnementDuCompte(existant: { userId: string }, userId: string): boolean {
  return existant.userId === userId;
}
