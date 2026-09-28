import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MOTIF_LIVRAISON_RESTAURANT, type EntreesStockResto } from "@/lib/stock-restaurant";

// Chargement GROUPÉ des entrées du stock théorique du restaurant — jamais une requête par article :
//   1. les articles du restaurant actifs (rattachements) ;
//   2. la date du dernier comptage de chaque article AVANT la période (une requête groupée) ;
//   3. les comptages : ce dernier comptage + tous ceux de la période ;
//   4. les sorties « Livraison restaurant » jusqu'à la fin de la période, à partir du plus ancien de
//      ces derniers comptages (sans borne si un article rattaché n'a jamais été compté : son stock
//      théorique est alors la somme de TOUTES ses livraisons).
// Lecture seule : rien n'est écrit, ni comptage, ni `Stock.quantite`.

const jourPur = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `depuis` / `jusquA` : dates PURES AAAA-MM-JJ, bornes incluses de la période affichée. */
export async function chargerEntreesStockResto({ depuis, jusquA }: { depuis: string; jusquA: string }): Promise<EntreesStockResto> {
  const [articles, avant] = await Promise.all([
    prisma.articleResto.findMany({
      where: { actif: true },
      select: { id: true, designation: true, espace: true, unite: true, articleStockId: true, articleStock: { select: { unite: true } } },
    }),
    prisma.comptageResto.groupBy({
      by: ["articleRestoId"],
      where: { date: { lt: jourPur(depuis) }, article: { actif: true } },
      _max: { date: true },
    }),
  ]);

  const derniers = avant.flatMap((g) => (g._max.date ? [{ articleRestoId: g.articleRestoId, date: g._max.date }] : []));
  const dernierAvant = new Map(derniers.map((d) => [d.articleRestoId, d.date]));
  const rattaches = articles.filter((a) => a.articleStockId !== null);
  let dateLivraison: Prisma.DateTimeFilter = { lte: jourPur(jusquA) };
  if (rattaches.length === 0) {
    dateLivraison = { gte: jourPur(depuis), lte: jourPur(jusquA) }; // seules les non rattachées de la période comptent
  } else if (rattaches.every((a) => dernierAvant.has(a.id))) {
    const borne = rattaches.map((a) => dernierAvant.get(a.id)!).reduce((x, y) => (x < y ? x : y));
    dateLivraison = { gt: borne, lte: jourPur(jusquA) };
  }

  const [comptages, livraisons] = await Promise.all([
    prisma.comptageResto.findMany({
      where: { article: { actif: true }, OR: [{ date: { gte: jourPur(depuis), lte: jourPur(jusquA) } }, ...derniers] },
      select: { articleRestoId: true, date: true, quantite: true },
    }),
    prisma.mouvementStock.findMany({
      where: { type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, date: dateLivraison },
      select: { id: true, articleId: true, date: true, quantite: true, categorieSortie: true, article: { select: { designation: true, unite: true } } },
    }),
  ]);

  return {
    articles: articles.map((a) => ({
      id: a.id, designation: a.designation, espace: a.espace, unite: a.unite, articleStockId: a.articleStockId,
      uniteCatalogue: a.articleStock?.unite ?? null,
    })),
    comptages: comptages.map((c) => ({ articleRestoId: c.articleRestoId, date: iso(c.date), quantite: c.quantite.toString() })),
    livraisons: livraisons.map((l) => ({
      id: l.id, articleStockId: l.articleId, designation: l.article.designation, uniteCatalogue: l.article.unite,
      date: iso(l.date), quantite: l.quantite.toString(), categorieSortie: l.categorieSortie,
    })),
  };
}
