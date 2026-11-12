import { aPermission, definitionPermission, type Permission, type SurchargesPermissions } from "@/lib/permissions";
import type { Role } from "@prisma/client";

/**
 * À utiliser dans les Server Actions : exige une PERMISSION réglée par la Direction (lib/permissions.ts).
 * Se place APRÈS la garde de rôle/espace (`requireRole`, `requireModule` de `lib/auth`), jamais à sa place.
 * La Direction passe toujours.
 *
 * Module séparé de `lib/auth` à dessein : c'est une fonction pure (aucune session, aucune base). Les
 * tests qui simulent `@/lib/auth` continuent ainsi d'exercer la VRAIE règle de permission.
 */
export function requirePermission(
  user: { role: Role; accesStock?: boolean; permissions?: SurchargesPermissions | null },
  permission: Permission,
): void {
  if (!aPermission(user, permission)) {
    throw new Error(`Accès refusé : la permission « ${definitionPermission(permission).libelle} » ne vous est pas accordée.`);
  }
}
