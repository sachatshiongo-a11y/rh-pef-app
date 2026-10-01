import type { PaymentStatus, Role } from "@prisma/client";

/** Libellés lisibles des 3 états de paie. */
export const LIBELLE_STATUT: Record<PaymentStatus, string> = {
  PAS_VALIDE: "Pas validé",
  VALIDE: "Validé",
  PAYE: "Payé",
};

/** Couleur de badge par état (couleur + libellé, jamais la couleur seule). */
export const COULEUR_STATUT: Record<PaymentStatus, string> = {
  PAS_VALIDE: "bg-amber-100 text-amber-800",
  VALIDE: "bg-blue-100 text-blue-800",
  PAYE: "bg-green-100 text-green-800",
};

/**
 * Transitions autorisées (3 états) : Pas validé → Validé → Payé.
 * Réouverture possible en cas d'erreur (Validé → Pas validé ; Payé → Validé), tracée à l'audit.
 */
const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PAS_VALIDE: ["VALIDE"],
  VALIDE: ["PAYE", "PAS_VALIDE"],
  PAYE: ["VALIDE"],
};

export function transitionAutorisee(de: PaymentStatus, vers: PaymentStatus): boolean {
  return TRANSITIONS[de]?.includes(vers) ?? false;
}

/** Transition autorisée dans une ACTION GROUPÉE. « Valider » en lot ne vaut jamais « annuler le
 *  paiement » : une ligne PAYÉE cochée par mégarde repasserait en VALIDÉ sans rien dire (bulletin
 *  refigé, frais médicaux remis à zéro). Annuler un paiement reste possible, ligne par ligne. */
export function transitionAutoriseeEnLot(de: PaymentStatus, vers: PaymentStatus): boolean {
  return transitionAutorisee(de, vers) && !(de === "PAYE" && vers === "VALIDE");
}

export function prochainsEtats(de: PaymentStatus): PaymentStatus[] {
  return TRANSITIONS[de] ?? [];
}

/**
 * QUI FAIT QUOI SUR UN BULLETIN (décision de Sacha du 2026-10-01 : « la Direction valide, la RH paie
 * ensuite »).
 *  - Valider (Pas validé → Validé), rouvrir (Validé → Pas validé), annuler un paiement (Payé →
 *    Validé) : la Direction seule (ADMIN). Un retour en arrière défait une décision de la Direction.
 *  - Payer (Validé → Payé) : la Direction ET la RH (MANAGER). La machine à états ne mène à « Payé »
 *    que depuis « Validé » (TRANSITIONS) : la RH ne paie jamais un bulletin que la Direction n'a pas
 *    validé, ni à l'unité ni glissé dans un lot.
 *  - Clôturer la paie du mois (ajout de Sacha, même jour) : la Direction ET la RH (`ROLES_CLOTURE`).
 *    La clôture de la Direction VALIDE d'un coup les bulletins « pas validé » restants ; la RH, elle,
 *    ne clôture qu'une paie que la Direction a ENTIÈREMENT validée (sinon refus) : sa clôture ferme
 *    la paie du mois sans rien valider. La RH ne fait donc JAMAIS passer une ligne en « Validé ».
 * La réinitialisation et le changement de mois (Paramètres, geste distinct de la clôture) restent
 * réservés à la Direction dans leurs propres actions. Le rôle est vérifié dans l'ACTION SERVEUR (pas
 * seulement par le bouton), puis revérifié ligne par ligne (`transitionPermise`).
 */
export function roleRequisPour(vers: PaymentStatus): Role[] {
  return vers === "PAYE" ? ["ADMIN", "MANAGER"] : ["ADMIN"];
}

/** Qui clôture la paie du mois. La RH seulement une paie déjà entièrement validée (cloturerPaie). */
export const ROLES_CLOTURE: Role[] = ["ADMIN", "MANAGER"];

/** Seule la Direction valide des bulletins en clôturant ; la RH ferme une paie déjà validée. */
export const cloturePeutValider = (role: Role) => role === "ADMIN";

/** Le rôle peut-il faire passer UNE ligne de `de` à `vers` (machine à états ET droit du rôle) ? */
export function transitionPermise(role: Role, de: PaymentStatus, vers: PaymentStatus, opts: { enLot?: boolean } = {}): boolean {
  const autorisee = opts.enLot ? transitionAutoriseeEnLot : transitionAutorisee;
  return autorisee(de, vers) && roleRequisPour(vers).includes(role);
}

/** États qu'un rôle peut atteindre depuis `de` (boutons d'une ligne) : la même règle que le serveur. */
export function prochainsEtatsPour(role: Role, de: PaymentStatus): PaymentStatus[] {
  return prochainsEtats(de).filter((vers) => transitionPermise(role, de, vers));
}
