import "server-only";

import type { Prisma } from "@prisma/client";
import { variationsStockTx } from "./stock-positif";
import { verrouillerFactures, verrouillerMouvements } from "./verrou-suppression";

type Tx = Prisma.TransactionClient;

/**
 * Cœur des deux suppressions (une facture, un lot) : dans la transaction, VERROUILLE les factures puis
 * leurs entrées AVANT de les lire, et ne reprend le stock QUE pour ce que cette transaction supprime.
 * Deux suppressions simultanées de la même facture (deux onglets, double clic) ou d'une facture et d'un
 * de ses mouvements n'appliquent donc l'inverse sur `Stock.quantite` qu'une fois ; la seconde trouve la
 * ligne partie (`dejaSupprimees`). Ordre des verrous : Facture → Mouvement → Stock (ids triés).
 */
export async function supprimerFacturesTx(tx: Tx, ids: string[]) {
  const vivantes = await verrouillerFactures(tx, ids);
  if (vivantes.size === 0) return { facs: [], dejaSupprimees: ids.length };
  const facs = await tx.factureFournisseur.findMany({ where: { id: { in: [...vivantes] } }, include: { mouvements: { where: { type: "ENTREE" }, select: { id: true } } } });
  // Entrées verrouillées à leur tour, puis relues : une entrée déjà emportée par la suppression d'un
  // mouvement ne doit pas être reprise une seconde fois.
  const entreesVivantes = await verrouillerMouvements(tx, facs.flatMap((f) => f.mouvements.map((m) => m.id)));
  const entrees = await tx.mouvementStock.findMany({ where: { id: { in: [...entreesVivantes] } }, select: { id: true, articleId: true, quantite: true } });
  // Reprise du stock entré par ces factures, avant suppression (leurs autres mouvements passeront à factureId=null).
  // Porte unique, tout le lot d'un coup : une reprise qui ferait passer un article sous 0 refuse tout.
  await variationsStockTx(tx, entrees.map((m) => ({ articleId: m.articleId, delta: m.quantite.negated() })), { verbe: "à reprendre" });
  await tx.mouvementStock.deleteMany({ where: { id: { in: entrees.map((m) => m.id) } } });
  await tx.factureFournisseur.deleteMany({ where: { id: { in: facs.map((f) => f.id) } } });
  return { facs, dejaSupprimees: ids.length - facs.length };
}
