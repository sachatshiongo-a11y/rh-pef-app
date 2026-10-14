import "server-only";

// Ce qui retient un article au catalogue : les lignes qui le citent (mouvements, factures, bons, commandes du
// restaurant, comptages). Lu UNE fois pour la suppression en lot et pour le changement d'unité en lot : les deux
// geste regardent le même historique, ils doivent le compter de la même façon.

import { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";

type Client = Prisma.TransactionClient | typeof prisma;

export type HistoriqueArticle = { mouvements: number; lignesFacture: number; lignesBon: number; commandesResto: number; comptages: number };
const VIDE: HistoriqueArticle = { mouvements: 0, lignesFacture: 0, lignesBon: 0, commandesResto: 0, comptages: 0 };

export async function historiqueDesArticles(client: Client, ids: readonly string[]): Promise<Map<string, HistoriqueArticle>> {
  const liste = [...new Set(ids)];
  const res = new Map<string, HistoriqueArticle>(liste.map((id) => [id, { ...VIDE }]));
  if (liste.length === 0) return res;
  const db = client as typeof prisma; // une transaction offre les mêmes lectures
  const comptes = await db.articleStock.findMany({
    where: { id: { in: liste } },
    select: { id: true, _count: { select: { mouvements: true, lignesFacture: true, lignesBC: true, commandesResto: true } } },
  });
  for (const c of comptes) {
    res.set(c.id, { mouvements: c._count.mouvements, lignesFacture: c._count.lignesFacture, lignesBon: c._count.lignesBC, commandesResto: c._count.commandesResto, comptages: 0 });
  }
  // `LigneComptage.articleId` n'a pas de relation Prisma (désignation figée, article libre) : décompte direct.
  const lignes = await db.$queryRaw<{ articleId: string; n: number }[]>`SELECT "articleId", COUNT(*)::int AS n FROM "stock"."LigneComptage" WHERE "articleId" IN (${Prisma.join(liste)}) GROUP BY "articleId"`;
  for (const l of lignes) { const h = res.get(l.articleId); if (h) h.comptages = l.n; }
  return res;
}
