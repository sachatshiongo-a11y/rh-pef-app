import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MOTIF_LIVRAISON_RESTAURANT, type EntreesStockResto } from "@/lib/stock-restaurant";
import { formaterNombre } from "@/lib/montant";
import { libelleArticle } from "@/lib/libelle-article";
import { chargerVentesEtConsommation } from "@/lib/ventes-consommation-charger";

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
      { liens: { some: { articleStock: { mouvements: { some: { type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, date: periode } } } } } },
    ],
  };
}

/** Désignation d'un article du restaurant dans un document : « (désactivé) » s'il l'est. */
export const designationResto = (a: { designation: string; actif: boolean }) => (a.actif ? a.designation : `${a.designation} (désactivé)`);

/**
 * `depuis` / `jusquA` : dates PURES AAAA-MM-JJ, bornes incluses de la période affichée.
 * `avecVentes` (2026-10-12) : charge aussi les ventes × fiches saisies depuis le dernier comptage de chaque
 * article rattaché, pour que le stock THÉORIQUE les retire (stock restaurant, disponibilité des plats).
 * `"periode"` : depuis le plus ancien comptage chargé (le contrôle des écarts compare deux comptages dont le
 * premier précède la période). Les vues de consommation RÉELLE n'en ont pas besoin et ne les chargent pas.
 * `inclureDesactives` : pour une période AFFICHÉE (consommation réelle, exports), les articles
 * désactivés qui ont un comptage ou une livraison dans la période restent (voir
 * `articlesRestoDeLaPeriode`). Sans lui (disponibilité, stock théorique du jour) : les actifs seuls.
 */
export async function chargerEntreesStockResto({ depuis, jusquA, inclureDesactives = false, avecVentes = false }: { depuis: string; jusquA: string; inclureDesactives?: boolean; avecVentes?: boolean | "periode" }): Promise<EntreesStockResto> {
  const filtre: Prisma.ArticleRestoWhereInput = inclureDesactives ? articlesRestoDeLaPeriode(depuis, jusquA) : { actif: true };
  const [articles, avant] = await Promise.all([
    prisma.articleResto.findMany({
      where: filtre,
      select: { id: true, designation: true, espace: true, unite: true, actif: true, liens: { select: { articleStock: { select: { id: true, designation: true, marque: true, unite: true, contenance: true, contenanceUnite: true, domaine: true } } } } },
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
  const rattachesComptes = articles.filter((a) => a.liens.length > 0 && dernierAvant.has(a.id));
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
      select: { id: true, articleId: true, date: true, quantite: true, categorieSortie: true, article: { select: { designation: true, marque: true, unite: true, domaine: true, contenance: true, contenanceUnite: true } } },
    }),
  ]);

  // Ventes × fiches : depuis le plus ancien des derniers comptages (≤ jusquA) des articles RATTACHÉS — une seule
  // requête de ventes ; la fenêtre propre à chaque article est appliquée par le calcul pur.
  let ventes: Pick<EntreesStockResto, "consoVentes" | "ventesAVerifier"> = {};
  if (avecVentes) {
    const dernierComptage = new Map<string, Date>();
    for (const c of comptages) if (c.date <= jourPur(jusquA) && (dernierComptage.get(c.articleRestoId) ?? new Date(0)) < c.date) dernierComptage.set(c.articleRestoId, c.date);
    const liees = new Set(articles.filter((a) => a.liens.length > 0).map((a) => a.id));
    const bornes = avecVentes === "periode"
      ? comptages.filter((c) => liees.has(c.articleRestoId) && c.date <= jourPur(jusquA)).map((c) => c.date)
      : articles.filter((a) => a.liens.length > 0 && dernierComptage.has(a.id)).map((a) => dernierComptage.get(a.id)!);
    if (bornes.length > 0) {
      const apres = iso(bornes.reduce((m, d) => (d < m ? d : m), bornes[0]!));
      const r = await chargerVentesEtConsommation({ apres, jusquA });
      ventes = { consoVentes: r.conso, ventesAVerifier: r.aVerifier };
    }
  }

  return {
    ...ventes,
    debutLivraisons: depuis,
    articles: articles.map((a) => ({
      id: a.id, designation: a.designation, espace: a.espace, unite: a.unite,
      rattaches: a.liens.map((l) => ({
        id: l.articleStock.id, unite: l.articleStock.unite, designation: libelleArticle(l.articleStock), domaine: l.articleStock.domaine,
        contenance: l.articleStock.contenance?.toString() ?? null, contenanceUnite: l.articleStock.contenanceUnite,
      })),
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
  articleRestoId: string; designation: string; unite: string | null;
  /** Articles du catalogue rattachés (une ou plusieurs marques) et leur unité. */
  articlesStock: { id: string; unite: string | null }[];
  /** Dernier comptage (date PURE AAAA-MM-JJ) et sa quantité, dans l'unité du restaurant. */
  dateComptage: string; compte: string;
  /** Livraisons du dépôt reçues DEPUIS ce comptage, une somme par article du catalogue (dans SON unité) ; vide : aucune. */
  livreDepuis: { quantite: string; unite: string | null }[];
};

/**
 * Articles du restaurant (filtre `where`) qui ont encore du stock COMPTÉ : dernier comptage > 0, ou
 * des livraisons du dépôt reçues depuis ce comptage (de n'importe lequel des articles rattachés).
 * Requêtes groupées, lecture seule.
 */
export async function stocksComptesResto(where: Prisma.ArticleRestoWhereInput): Promise<StockCompteResto[]> {
  const articles = await prisma.articleResto.findMany({
    where,
    select: { id: true, designation: true, unite: true, liens: { select: { articleStock: { select: { id: true, unite: true } } } } },
  });
  if (articles.length === 0) return [];
  const derniers = (await prisma.comptageResto.groupBy({ by: ["articleRestoId"], where: { articleRestoId: { in: articles.map((a) => a.id) } }, _max: { date: true } }))
    .flatMap((g) => (g._max.date ? [{ articleRestoId: g.articleRestoId, date: g._max.date }] : []));
  if (derniers.length === 0) return [];
  const comptages = await prisma.comptageResto.findMany({ where: { OR: derniers }, select: { articleRestoId: true, date: true, quantite: true } });
  const parArticle = new Map(comptages.map((c) => [c.articleRestoId, c]));
  const catalogue = [...new Set(articles.filter((a) => parArticle.has(a.id)).flatMap((a) => a.liens.map((l) => l.articleStock.id)))];
  const plusAncien = derniers.reduce((m, d) => (d.date < m ? d.date : m), derniers[0]!.date);
  const livraisons = catalogue.length === 0 ? [] : await prisma.mouvementStock.findMany({
    where: { type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT, articleId: { in: catalogue }, date: { gt: plusAncien } },
    select: { articleId: true, date: true, quantite: true },
  });
  const out: StockCompteResto[] = [];
  for (const a of articles) {
    const c = parArticle.get(a.id);
    if (!c) continue;
    const parMarque = a.liens.map((l) => {
      const recues = livraisons.filter((m) => m.articleId === l.articleStock.id && m.date > c.date);
      return { quantite: recues.reduce((t, m) => t + Number(m.quantite), 0), unite: l.articleStock.unite, nb: recues.length };
    }).filter((x) => x.nb > 0);
    // Seul le positif compte pour décider (comme avant) ; des unités différentes ne s'additionnent jamais.
    if (Number(c.quantite) <= 0 && parMarque.every((x) => x.quantite <= 0)) continue;
    out.push({
      articleRestoId: a.id, designation: a.designation, unite: a.unite, articlesStock: a.liens.map((l) => ({ id: l.articleStock.id, unite: l.articleStock.unite })),
      dateComptage: iso(c.date), compte: c.quantite.toString(), livreDepuis: parMarque.map((x) => ({ quantite: String(x.quantite), unite: x.unite })),
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
    `« ${s.designation} » : ${qte(s.compte, s.unite)} comptés au restaurant le ${jjmm(s.dateComptage)}${s.livreDepuis.length > 0 ? `, et ${s.livreDepuis.map((l) => qte(l.quantite, l.unite)).join(" et ")} livrés depuis` : ""}.`);
  return `${lignes.join(" ")} Désactiver quand même ? Ce stock ne sera plus compté dans la disponibilité des plats : les plats qui l'utilisent passeront « À vérifier ».`;
}
