import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MOTIF_LIVRAISON_RESTAURANT, type EntreesStockResto } from "@/lib/stock-restaurant";
import { formaterNombre } from "@/lib/montant";
import { libelleArticle } from "@/lib/libelle-article";

// Chargement GROUPÉ des entrées du stock théorique du restaurant — jamais une requête par article :
//   1. les articles du restaurant actifs (rattachements) ;
//   2. la date du dernier comptage de chaque article AVANT la période (une requête groupée) ;
//   3. les comptages : ce dernier comptage + tous ceux de la période ;
//   4. les sorties « Livraison restaurant » de la période, et, pour les articles comptés avant elle,
//      celles reçues depuis le plus ancien de ces derniers comptages. Jamais tout l'historique : un
//      article jamais compté n'estime son stock que sur la période (`debutLivraisons`).
// Lecture seule : rien n'est écrit, ni comptage, ni `Stock.quantite`.

const jourPur = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Articles du restaurant à montrer pour une PÉRIODE passée (exports, consommation réelle) : les
 * actifs, et les DÉSACTIVÉS qui ont un comptage ou une livraison dans la période — leur historique
 * ne disparaît jamais des documents (ils portent alors la mention « (désactivé) »).
 */
export function articlesRestoDeLaPeriode(depuis: string, jusquA: string): Prisma.ArticleRestoWhereInput {
  const periode = { gte: jourPur(depuis), lte: jourPur(jusquA) };
  return {
    OR: [
      { actif: true },
      { comptages: { some: { date: periode } } },
      { articleStock: { mouvements: { some: { type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, date: periode } } } },
    ],
  };
}

/** Désignation d'un article du restaurant dans un document : « (désactivé) » s'il l'est. */
export const designationResto = (a: { designation: string; actif: boolean }) => (a.actif ? a.designation : `${a.designation} (désactivé)`);

/**
 * `depuis` / `jusquA` : dates PURES AAAA-MM-JJ, bornes incluses de la période affichée.
 * `inclureDesactives` : pour une période AFFICHÉE (consommation réelle, exports), les articles
 * désactivés qui ont un comptage ou une livraison dans la période restent (voir
 * `articlesRestoDeLaPeriode`). Sans lui (disponibilité, stock théorique du jour) : les actifs seuls.
 */
export async function chargerEntreesStockResto({ depuis, jusquA, inclureDesactives = false }: { depuis: string; jusquA: string; inclureDesactives?: boolean }): Promise<EntreesStockResto> {
  const filtre: Prisma.ArticleRestoWhereInput = inclureDesactives ? articlesRestoDeLaPeriode(depuis, jusquA) : { actif: true };
  const [articles, avant] = await Promise.all([
    prisma.articleResto.findMany({
      where: filtre,
      select: { id: true, designation: true, espace: true, unite: true, actif: true, articleStockId: true, articleStock: { select: { unite: true, contenance: true, contenanceUnite: true } } },
    }),
    prisma.comptageResto.groupBy({
      by: ["articleRestoId"],
      where: { date: { lt: jourPur(depuis) }, article: filtre },
      _max: { date: true },
    }),
  ]);

  const derniers = avant.flatMap((g) => (g._max.date ? [{ articleRestoId: g.articleRestoId, date: g._max.date }] : []));
  const dernierAvant = new Map(derniers.map((d) => [d.articleRestoId, d.date]));
  // Livraisons utiles : celles de la période, et, pour un article COMPTÉ avant la période, celles
  // reçues depuis ce comptage. Un article jamais compté n'a besoin que de la période (C1 : sans
  // comptage, le stock n'est qu'une estimation, hors des portions).
  const rattachesComptes = articles.filter((a) => a.articleStockId !== null && dernierAvant.has(a.id));
  const borne = rattachesComptes.map((a) => dernierAvant.get(a.id)!).reduce<Date | null>((x, y) => (x === null || y < x ? y : x), null);
  const dateLivraison: Prisma.DateTimeFilter = borne !== null && borne < jourPur(depuis)
    ? { gt: borne, lte: jourPur(jusquA) }
    : { gte: jourPur(depuis), lte: jourPur(jusquA) };

  const [comptages, livraisons] = await Promise.all([
    prisma.comptageResto.findMany({
      where: { article: filtre, OR: [{ date: { gte: jourPur(depuis), lte: jourPur(jusquA) } }, ...derniers] },
      select: { articleRestoId: true, date: true, quantite: true },
    }),
    prisma.mouvementStock.findMany({
      where: { type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, date: dateLivraison },
      select: { id: true, articleId: true, date: true, quantite: true, categorieSortie: true, article: { select: { designation: true, unite: true, domaine: true, contenance: true, contenanceUnite: true } } },
    }),
  ]);

  return {
    debutLivraisons: depuis,
    articles: articles.map((a) => ({
      id: a.id, designation: a.designation, espace: a.espace, unite: a.unite, articleStockId: a.articleStockId,
      uniteCatalogue: a.articleStock?.unite ?? null,
      contenanceCatalogue: a.articleStock?.contenance?.toString() ?? null, contenanceUniteCatalogue: a.articleStock?.contenanceUnite ?? null,
      ...(a.actif ? {} : { inactif: true }),
    })),
    comptages: comptages.map((c) => ({ articleRestoId: c.articleRestoId, date: iso(c.date), quantite: c.quantite.toString() })),
    livraisons: livraisons.map((l) => ({
      id: l.id, articleStockId: l.articleId, designation: libelleArticle(l.article), uniteCatalogue: l.article.unite,
      contenanceCatalogue: l.article.contenance?.toString() ?? null, contenanceUniteCatalogue: l.article.contenanceUnite,
      date: iso(l.date), quantite: l.quantite.toString(), categorieSortie: l.categorieSortie, domaine: l.article.domaine,
    })),
  };
}

// ─── Stock encore compté d'un article du restaurant (désactivation) ─────────────────────────────

export type StockCompteResto = {
  articleRestoId: string; designation: string; unite: string | null; articleStockId: string | null; uniteCatalogue: string | null;
  /** Dernier comptage (date PURE AAAA-MM-JJ) et sa quantité, dans l'unité du restaurant. */
  dateComptage: string; compte: string;
  /** Livraisons du dépôt reçues DEPUIS ce comptage, dans l'unité du catalogue ; null : aucune. */
  livreDepuis: string | null;
};

/**
 * Articles du restaurant (filtre `where`) qui ont encore du stock COMPTÉ : dernier comptage > 0, ou
 * des livraisons du dépôt reçues depuis ce comptage. Requêtes groupées, lecture seule.
 */
export async function stocksComptesResto(where: Prisma.ArticleRestoWhereInput): Promise<StockCompteResto[]> {
  const articles = await prisma.articleResto.findMany({
    where,
    select: { id: true, designation: true, unite: true, articleStockId: true, articleStock: { select: { unite: true } } },
  });
  if (articles.length === 0) return [];
  const derniers = (await prisma.comptageResto.groupBy({ by: ["articleRestoId"], where: { articleRestoId: { in: articles.map((a) => a.id) } }, _max: { date: true } }))
    .flatMap((g) => (g._max.date ? [{ articleRestoId: g.articleRestoId, date: g._max.date }] : []));
  if (derniers.length === 0) return [];
  const comptages = await prisma.comptageResto.findMany({ where: { OR: derniers }, select: { articleRestoId: true, date: true, quantite: true } });
  const parArticle = new Map(comptages.map((c) => [c.articleRestoId, c]));
  const catalogue = articles.filter((a) => a.articleStockId && parArticle.has(a.id)).map((a) => a.articleStockId!);
  const plusAncien = derniers.reduce((m, d) => (d.date < m ? d.date : m), derniers[0]!.date);
  const livraisons = catalogue.length === 0 ? [] : await prisma.mouvementStock.findMany({
    where: { type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, articleId: { in: catalogue }, date: { gt: plusAncien } },
    select: { articleId: true, date: true, quantite: true },
  });
  const out: StockCompteResto[] = [];
  for (const a of articles) {
    const c = parArticle.get(a.id);
    if (!c) continue;
    const recues = a.articleStockId ? livraisons.filter((l) => l.articleId === a.articleStockId && l.date > c.date) : [];
    const livre = recues.reduce((t, l) => t + Number(l.quantite), 0);
    if (Number(c.quantite) <= 0 && livre <= 0) continue;
    out.push({
      articleRestoId: a.id, designation: a.designation, unite: a.unite, articleStockId: a.articleStockId, uniteCatalogue: a.articleStock?.unite ?? null,
      dateComptage: iso(c.date), compte: c.quantite.toString(), livreDepuis: recues.length ? String(livre) : null,
    });
  }
  return out;
}

const jjmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const qte = (q: string, unite: string | null) => `${formaterNombre(Number(q), { maximumFractionDigits: 3 })}${unite ? ` ${unite}` : ""}`;

/**
 * Confirmation de désactivation : nomme ce qui est encore compté (le PROVISOIRE : le stock d'après
 * le dernier comptage et les livraisons reçues depuis) ET ce qui sera figé (ce stock ne comptera
 * plus dans la disponibilité des plats).
 */
export function messageDesactivation(stocks: StockCompteResto[]): string {
  const lignes = stocks.map((s) =>
    `« ${s.designation} » : ${qte(s.compte, s.unite)} comptés au restaurant le ${jjmm(s.dateComptage)}${s.livreDepuis ? `, et ${qte(s.livreDepuis, s.uniteCatalogue)} livrés depuis` : ""}.`);
  return `${lignes.join(" ")} Désactiver quand même ? Ce stock ne sera plus compté dans la disponibilité des plats : les plats qui l'utilisent passeront « À vérifier ».`;
}
