import "server-only";

import { Prisma } from "@prisma/client";

// VERROU DES SUPPRESSIONS QUI REPRENNENT UN STOCK. Supprimer un mouvement (ou une facture, donc ses
// entrées) annule son effet sur `Stock.quantite`. Deux suppressions simultanées du même objet (deux
// onglets, double clic) ne doivent appliquer cet effet QU'UNE FOIS : la ligne est donc VERROUILLÉE
// (`FOR UPDATE`, ids triés) AVANT de lire ce qu'on va défaire. Sous READ COMMITTED, la transaction
// qui arrive seconde attend la première ; une fois celle-ci validée, la ligne a disparu et n'est plus
// rendue : la seconde n'a rien à reprendre. Si la première échoue (rollback), la seconde la reprend.
//
// Ordre des verrous, toujours le même : Facture → Mouvement → Stock (ids triés, `verrouillerStocks`
// via la porte `stock-positif.ts`). Aucune écriture du stock ici : ce fichier ne fait que verrouiller.

type Tx = Prisma.TransactionClient;

async function verrouiller(tx: Tx, table: "MouvementStock" | "FactureFournisseur", ids: string[]): Promise<Set<string>> {
  const uniq = [...new Set(ids)].sort();
  if (uniq.length === 0) return new Set();
  const lignes = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "stock".${Prisma.raw(`"${table}"`)} WHERE "id" IN (${Prisma.join(uniq)}) ORDER BY "id" FOR UPDATE`;
  return new Set(lignes.map((l) => l.id));
}

/** Verrouille les mouvements demandés et rend les id de ceux qui EXISTENT encore (les autres sont déjà supprimés). */
export const verrouillerMouvements = (tx: Tx, ids: string[]) => verrouiller(tx, "MouvementStock", ids);

/** Verrouille les factures demandées et rend les id de celles qui EXISTENT encore. */
export const verrouillerFactures = (tx: Tx, ids: string[]) => verrouiller(tx, "FactureFournisseur", ids);
