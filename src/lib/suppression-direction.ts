import type { Role } from "@prisma/client";

/**
 * SUPPRIMER EST RÉSERVÉ À LA DIRECTION.
 *
 * Règle de Sacha (2026-10-01) : « un autre utilisateur que la direction ne peut et ne doit rien
 * supprimer, articles, fiches techniques, salarié, etc ». Toute action serveur qui efface un
 * enregistrement EXISTANT (suppression, fusion qui supprime un doublon, effacement d'une saisie de
 * présence, photo retirée…) appelle l'une des deux gardes ci-dessous, DANS l'action elle-même : le
 * bouton masqué ne protège rien, une action serveur s'appelle directement avec les arguments de son
 * choix. Pour un compte qui n'est pas la Direction, rien n'est écrit et le refus revient comme une
 * valeur lisible.
 *
 * `src/app/suppressions-direction.test.ts` vérifie que chaque fichier "use server" / `route.ts`
 * qui supprime appelle l'une de ces gardes, sauf exceptions nommées (saisie de grille, technique…).
 *
 * Module PUR (ni session, ni base) : les pages s'en servent aussi pour masquer les boutons.
 */

export const MESSAGE_SUPPRESSION_RESERVEE = "Supprimer est réservé à la Direction.";

/** Vrai pour la Direction (ADMIN) — le seul rôle qui supprime. */
export function peutSupprimer(user: { role: Role }): boolean {
  return user.role === "ADMIN";
}

/**
 * Garde « qui jette » : à utiliser dans une action enrobée par `actionLisible` ou `formulaireLisible`
 * (l'erreur y revient comme une valeur / un message de page, jamais comme une page d'erreur).
 */
export function exigerDirectionPourSupprimer(user: { role: Role }, message: string = MESSAGE_SUPPRESSION_RESERVEE): void {
  if (!peutSupprimer(user)) throw new Error(message);
}

/**
 * Garde « qui renvoie » : pour une action NON enrobée, dont l'appelant lit le résultat.
 *
 *     const refus = refusSuppression(user);
 *     if (refus) return refus;
 */
export function refusSuppression(user: { role: Role }, message: string = MESSAGE_SUPPRESSION_RESERVEE): { erreur: string } | null {
  return peutSupprimer(user) ? null : { erreur: message };
}

/** Présences : vider une case qui porte un code ENREGISTRÉ efface le pointage du jour. */
export const MESSAGE_EFFACER_PRESENCE =
  "Effacer une présence déjà saisie est réservé à la Direction : remplacez plutôt le code (O, A, N…).";
