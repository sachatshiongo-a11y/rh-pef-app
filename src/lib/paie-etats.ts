import type { PaymentStatus } from "@prisma/client";

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

export function prochainsEtats(de: PaymentStatus): PaymentStatus[] {
  return TRANSITIONS[de] ?? [];
}

/** Toutes les transitions de paie (validation, paiement, réouverture) sont réservées à l'Admin. */
export function roleRequisPour(_vers?: PaymentStatus): ("ADMIN" | "MANAGER")[] {
  return ["ADMIN"];
}
