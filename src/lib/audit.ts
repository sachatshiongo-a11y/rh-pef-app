import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type ClientAudit = Prisma.TransactionClient | typeof prisma;

/**
 * Enregistre une entrée au journal d'audit (qui / quand / champ / avant / après).
 * À appeler pour toute modification sensible : salaire, contrat, congé validé,
 * présence corrigée, transition de statut de paie, etc.
 */
export async function journaliser(
  client: ClientAudit,
  params: {
    entite: string;
    entiteId: string;
    champ: string;
    ancienneValeur?: string | number | null;
    nouvelleValeur?: string | number | null;
    userId: string;
  }
) {
  await client.journalAudit.create({
    data: {
      entite: params.entite,
      entiteId: params.entiteId,
      champ: params.champ,
      ancienneValeur:
        params.ancienneValeur === undefined || params.ancienneValeur === null
          ? null
          : String(params.ancienneValeur),
      nouvelleValeur:
        params.nouvelleValeur === undefined || params.nouvelleValeur === null
          ? null
          : String(params.nouvelleValeur),
      userId: params.userId,
    },
  });
}
