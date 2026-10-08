import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tauxUtilisable } from "@/lib/prix-article";

/**
 * Taux du jour (1 $ = N FC) : celui des Paramètres (`Config.tauxChangeCDF`), tenu par la Direction.
 * null s'il manque ou vaut 0 — jamais un repli figé (un franc sans taux s'affiche « — »).
 */
export async function tauxDuJour(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<number | null> {
  const config = await client.config.findUnique({ where: { id: "singleton" }, select: { tauxChangeCDF: true } });
  return tauxUtilisable(config ? Number(config.tauxChangeCDF) : null);
}
