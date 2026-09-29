import "server-only";

import type { Prisma } from "@prisma/client";
import { journaliserPlusieurs } from "@/lib/audit";
import { chargerSoldesCongeSalaries, type SoldeConge } from "@/lib/solde-conge-salarie";

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
 *
 * L'APPROBATION NE DÉPEND JAMAIS DU SOLDE. Si le solde est illisible (exercice fiscal inactif,
 * droits annuels absents, requête en échec), les demandes restent approuvées SANS instantané — le
 * PDF imprimera alors le solde du jour, daté de l'édition — et l'échec est écrit au JOURNAL
 * D'AUDIT (champ `soldeFige`, une ligne par demande : visible de la Direction, dans la même
 * transaction) et en `console.error` (journaux Render).
 * La lecture se fait sous un POINT DE SAUVEGARDE : une requête SQL en échec met toute la
 * transaction PostgreSQL en échec (« current transaction is aborted ») ; `ROLLBACK TO SAVEPOINT`
 * la remet d'aplomb, et le changement de statut, écrit avant, est conservé.
 */
export async function figerSoldesApprobation(
  tx: Prisma.TransactionClient,
  demandes: { id: string; employeeId: string }[],
  maintenant: Date,
  userId: string,
): Promise<void> {
  if (demandes.length === 0) return;
  let soldes: Map<string, SoldeConge>;
  await tx.$executeRawUnsafe("SAVEPOINT solde_fige");
  try {
    ({ soldes } = await chargerSoldesCongeSalaries(tx, [...new Set(demandes.map((d) => d.employeeId))], maintenant));
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT solde_fige");
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT solde_fige");
    // Une ligne, bornée : les messages de Prisma s'étalent sur plusieurs lignes.
    const raison = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 300);
    console.error(`[solde figé] solde illisible, ${demandes.length} demande(s) approuvée(s) sans instantané : ${raison}`);
    await journaliserPlusieurs(
      tx,
      demandes.map((d) => ({
        entite: "LeaveRequest",
        entiteId: d.id,
        champ: "soldeFige",
        nouvelleValeur: `non figé (solde illisible : ${raison})`,
        userId,
      })),
    );
    return;
  }
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
