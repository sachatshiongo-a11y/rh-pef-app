import type { Role } from "@prisma/client";

/**
 * Libellés de TOUS les rôles de la base. `Record<Role, …>` : un rôle ajouté au schéma sans libellé
 * ne compile pas. C'est la leçon du 2026-09-23 : la liste de l'écran « Utilisateurs & accès » ne
 * connaissait que 4 rôles sur 6 ; pour un compte salarié (EMPLOYE), le navigateur affichait la
 * PREMIÈRE option, « Direction », alors que le compte n'avait aucun droit de direction.
 */
export const ROLE_LIBELLE: Record<Role, string> = {
  ADMIN: "Direction",
  MANAGER: "RH",
  VIEWER: "Consultation",
  STOCK: "Stock",
  COMPTA: "Comptabilité",
  EMPLOYE: "Salarié",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: "Accès total : RH, paie, paramètres ET Stock & Achats",
  MANAGER: "Saisit les demandes et vérifie les bulletins, mais ne valide rien",
  VIEWER: "Consultation seule",
  STOCK: "Espace Stock & Achats uniquement (aucun accès RH ni paie)",
  COMPTA: "Espace Exploitation (finance) uniquement",
  EMPLOYE: "Espace salarié uniquement — se gère depuis la fiche du salarié",
};

/** Rôles qu'on peut attribuer depuis « Utilisateurs & accès ». Les comptes salariés (EMPLOYE) se
 *  gèrent depuis la fiche du salarié (création en lot, accès Stock) ; COMPTA n'est attribuable nulle
 *  part aujourd'hui. */
export const ROLES_ATTRIBUABLES = ["ADMIN", "MANAGER", "VIEWER", "STOCK"] as const satisfies readonly Role[];

export function roleModifiableIci(role: Role): boolean {
  return (ROLES_ATTRIBUABLES as readonly Role[]).includes(role);
}
