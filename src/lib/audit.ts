import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type ClientAudit = Prisma.TransactionClient | typeof prisma;

/** Une entrée du journal d'audit (qui / quoi / avant / après). */
export type EntreeJournal = {
  entite: string;
  entiteId: string;
  champ: string;
  ancienneValeur?: string | number | null;
  nouvelleValeur?: string | number | null;
  userId: string;
};

const texte = (v: string | number | null | undefined) => (v === undefined || v === null ? null : String(v));

/**
 * Enregistre une entrée au journal d'audit (qui / quand / champ / avant / après).
 * À appeler pour toute modification sensible : salaire, contrat, congé validé,
 * présence corrigée, transition de statut de paie, etc.
 */
export async function journaliser(client: ClientAudit, params: EntreeJournal) {
  await journaliserPlusieurs(client, [params]);
}

/** Plusieurs entrées en une requête (ex. une génération de planning : des centaines de créneaux). */
export async function journaliserPlusieurs(client: ClientAudit, entrees: EntreeJournal[]) {
  if (entrees.length === 0) return;
  await client.journalAudit.createMany({
    data: entrees.map((e) => ({
      entite: e.entite,
      entiteId: e.entiteId,
      champ: e.champ,
      ancienneValeur: texte(e.ancienneValeur),
      nouvelleValeur: texte(e.nouvelleValeur),
      userId: e.userId,
    })),
  });
}
