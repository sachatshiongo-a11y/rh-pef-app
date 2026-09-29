import "server-only";

import type { Prisma } from "@prisma/client";
import { chargerSoldesCongeSalaries } from "@/lib/solde-conge-salarie";

/**
 * L'INSTANTANÉ DU SOLDE À L'APPROBATION D'UNE DEMANDE DE CONGÉ (décision Direction 2026-09-29).
 *
 * À appeler DANS la transaction qui passe les demandes à APPROUVÉ, APRÈS l'écriture du statut :
 * la source unique (`chargerSoldesCongeSalaries`) relit alors, dans la même transaction, les
 * demandes approuvées de l'année — CETTE demande comprise. Le chiffre figé est donc le solde
 * « après approbation », celui qu'imprimait le PDF le jour même (voir `lib/solde-conge-imprime.ts`).
 *
 * En lot : 4 requêtes de lecture quel que soit le nombre de salariés, puis une écriture par
 * demande (chaque demande a son propre chiffre). Deux demandes d'un même salarié approuvées dans
 * le même lot portent le même solde : celui qui se lit une fois le lot approuvé, comme le PDF de
 * chacune l'aurait imprimé à cet instant.
 */
export async function figerSoldesApprobation(
  tx: Prisma.TransactionClient,
  demandes: { id: string; employeeId: string }[],
  maintenant: Date,
): Promise<void> {
  if (demandes.length === 0) return;
  const { soldes } = await chargerSoldesCongeSalaries(tx, [...new Set(demandes.map((d) => d.employeeId))], maintenant);
  for (const d of demandes) {
    const s = soldes.get(d.employeeId);
    // Salarié introuvable : impossible (clé étrangère, suppression en cascade). Sans chiffre, on
    // n'invente rien : la demande reste sans instantané et le PDF dira « date d'édition ».
    if (!s) continue;
    await tx.leaveRequest.update({
      where: { id: d.id },
      data: { soldeFigeJours: s.solde, soldeFigeAcquis: s.acquis, soldeFigePris: s.pris, soldeFigeLe: maintenant },
    });
  }
}

/**
 * À poser sur toute écriture qui fait QUITTER le statut APPROUVÉ (refus d'une demande approuvée).
 * L'instantané décrit une approbation : l'approbation retirée, il est EFFACÉ, pas « conservé mais
 * ignoré » — une colonne qui garde un chiffre sans décision derrière finit toujours par être lue par
 * quelqu'un (export, script, nouvel écran). La trace reste au journal d'audit, et une nouvelle
 * approbation reprend un nouvel instantané.
 */
export const INSTANTANE_SOLDE_EFFACE = {
  soldeFigeJours: null,
  soldeFigeAcquis: null,
  soldeFigePris: null,
  soldeFigeLe: null,
} as const;

/** Résumé lisible d'un instantané pour le journal d'audit (« 12.5 j au 2026-09-29T… »), ou null. */
export function resumeInstantane(d: { soldeFigeJours: { toString(): string } | null; soldeFigeLe: Date | null }): string | null {
  if (d.soldeFigeJours === null || d.soldeFigeLe === null) return null;
  return `${Number(d.soldeFigeJours.toString())} j au ${new Date(d.soldeFigeLe).toISOString()}`;
}
