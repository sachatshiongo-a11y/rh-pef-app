import type { Role } from "@prisma/client";

// Prédicats d'accès par espace — la SOURCE UNIQUE des règles, partagée par les layouts
// (`app/(app)/layout.tsx`, `(stock)`, `(exploitation)`, `espace`), par `requireModule` et par les
// gardes des Route Handlers (`lib/garde-route.ts`). Module pur : aucune session, aucune base.
// Voir `lib/auth.ts` pour la description des deux dimensions (rôle / fiche employé).

export function estRH(role: Role): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "VIEWER";
}

/** Accès à l'espace Stock : rôles Stock/Direction, OU un salarié à qui l'accès stock a été accordé. */
export function estStock(user: { role: Role; accesStock?: boolean }): boolean {
  return user.role === "ADMIN" || user.role === "STOCK" || (user.role === "EMPLOYE" && !!user.accesStock);
}

/** Accès à l'espace Exploitation (finance : journal de caisse, comptes de trésorerie, plan comptable) :
 *  Direction ou rôle Compta dédié. */
export function estExploitation(user: { role: Role }): boolean {
  return user.role === "ADMIN" || user.role === "COMPTA";
}

/** A un espace salarié : TOUT compte relié à une fiche employé, quel que soit son rôle.
 *  La Direction (ADMIN/MANAGER) qui est aussi salariée y consulte SES bulletins et congés, et peut
 *  prévisualiser l'espace avant de l'ouvrir aux équipes. Sans risque : chaque page/route de
 *  l'espace est déjà limitée aux données de `user.employeeId`.
 *  Ne dépend PAS de l'accès stock. Toujours conditionné à l'activation de la fonctionnalité. */
export function estSalarie(user: { role: Role; employeeId?: string | null }): boolean {
  return !!user.employeeId;
}
