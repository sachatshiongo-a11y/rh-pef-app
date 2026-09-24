import "server-only";

import { prisma } from "@/lib/prisma";
import { niveauAlerte } from "@/lib/stock";

// Indicateurs du Stock partagés : UNE seule source de vérité pour l'accueil Stock et le tableau de
// bord de l'Exploitation. Formules recopiées à l'identique de l'accueil Stock (un test de
// non-régression le prouve) ; les alertes passent par `niveauAlerte`, sans rien changer à sa règle.

export type ArticleEnAlerte = { articleId: string; designation: string; quantite: number; niveau: "URGENT" | "APPRO" };

/** `montant` : null quand il n'y a rien à sommer (l'accueil affiche alors « — », jamais « 0,00 $ »). */
export type SommeComptee = { montant: number | null; nb: number };

export type IndicateursStock = {
  valeurStock: number;
  nbUrgent: number;
  nbAppro: number;
  /** Urgents d'abord, puis à réapprovisionner ; tronqué à `nbAlertes`. */
  alertes: ArticleEnAlerte[];
  facturesAPayer: SommeComptee;
  facturesSemaine: SommeComptee;
  facturesEchues: SommeComptee;
  legumesMois: SommeComptee;
  consoMois: { montant: number; nb: number };
};

const somme = (agg: { _sum: Record<string, unknown>; _count: number }, champ: string): SommeComptee => {
  const v = agg._sum[champ];
  return { montant: v === null || v === undefined ? null : Number(v), nb: agg._count };
};

export async function indicateursStock(aujourdhui: Date, options: { nbAlertes?: number } = {}): Promise<IndicateursStock> {
  const nbAlertes = options.nbAlertes ?? 5;
  // Bornes de dates en UTC (cohérent avec le stockage @db.Date) — mêmes calculs que l'accueil Stock.
  const jjUTC = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth(), aujourdhui.getUTCDate()));
  const dow = jjUTC.getUTCDay(); // 0 = dimanche
  const lundi = new Date(jjUTC); lundi.setUTCDate(jjUTC.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const dimanche = new Date(lundi); dimanche.setUTCDate(lundi.getUTCDate() + 6);
  const debutMois = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth(), 1));
  const debutMoisSuivant = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() + 1, 1));

  const [stocks, facturesDues, facturesSemaine, facturesEchues, legumesMois, consoMois] = await Promise.all([
    prisma.stock.findMany({ include: { article: { select: { designation: true, prixUnitaireUSD: true } } } }),
    prisma.factureFournisseur.aggregate({ where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }, _sum: { resteAPayerUSD: true }, _count: true }),
    // Factures dont l'échéance tombe cette semaine (lun→dim), non réglées.
    prisma.factureFournisseur.aggregate({ where: { statut: { not: "REGLEE" }, dateEcheance: { gte: lundi, lte: dimanche } }, _sum: { resteAPayerUSD: true }, _count: true }),
    // Factures échues non réglées.
    prisma.factureFournisseur.aggregate({ where: { statut: "ECHUE_NON_REGLEE" }, _sum: { resteAPayerUSD: true }, _count: true }),
    // Achats de légumes frais du mois en cours.
    prisma.achatLegume.aggregate({ where: { date: { gte: debutMois, lt: debutMoisSuivant } }, _sum: { montantUSD: true }, _count: true }),
    // Consommation du mois : sorties valorisées (montant saisi, sinon quantité × prix catalogue).
    prisma.$queryRaw<{ total: number; n: number }[]>`
      SELECT COALESCE(SUM(COALESCE(m."montantUSD", m."quantite" * a."prixUnitaireUSD")), 0)::float AS total, COUNT(*)::int AS n
      FROM "stock"."MouvementStock" m JOIN "stock"."ArticleStock" a ON a."id" = m."articleId"
      WHERE m."type" = 'SORTIE' AND m."date" >= ${debutMois} AND m."date" < ${debutMoisSuivant}`,
  ]);

  const avecAlerte = stocks.map((s) => ({
    articleId: s.articleId,
    designation: s.article.designation,
    quantite: Number(s.quantite),
    niveau: niveauAlerte(s.quantite, s.stockMinimum),
    valeur: s.article.prixUnitaireUSD ? Number(s.quantite) * Number(s.article.prixUnitaireUSD) : 0,
  }));
  const alertes: ArticleEnAlerte[] = avecAlerte
    .filter((a) => a.niveau === "URGENT" || a.niveau === "APPRO")
    .sort((a, b) => (a.niveau === "URGENT" ? 0 : 1) - (b.niveau === "URGENT" ? 0 : 1))
    .slice(0, nbAlertes)
    .map((a) => ({ articleId: a.articleId, designation: a.designation, quantite: a.quantite, niveau: a.niveau as "URGENT" | "APPRO" }));

  return {
    valeurStock: avecAlerte.reduce((t, a) => t + a.valeur, 0),
    nbUrgent: avecAlerte.filter((a) => a.niveau === "URGENT").length,
    nbAppro: avecAlerte.filter((a) => a.niveau === "APPRO").length,
    alertes,
    facturesAPayer: somme(facturesDues, "resteAPayerUSD"),
    facturesSemaine: somme(facturesSemaine, "resteAPayerUSD"),
    facturesEchues: somme(facturesEchues, "resteAPayerUSD"),
    legumesMois: somme(legumesMois, "montantUSD"),
    consoMois: { montant: consoMois[0]?.total ?? 0, nb: consoMois[0]?.n ?? 0 },
  };
}
