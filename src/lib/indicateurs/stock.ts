import "server-only";

import { valeurEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { prisma } from "@/lib/prisma";
import { niveauAlerte } from "@/lib/stock";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// Indicateurs du Stock partagés : UNE seule source de vérité pour l'accueil Stock et le tableau de
// bord de l'Exploitation. Formules recopiées à l'identique de l'accueil Stock (un test de
// non-régression le prouve) ; les alertes passent par `niveauAlerte`, sans rien changer à sa règle.

export type ArticleEnAlerte = { articleId: string; designation: string; quantite: number; niveau: "URGENT" | "APPRO" };

/** `montant` : null quand il n'y a rien à sommer (l'accueil affiche alors « — », jamais « 0,00 $ »). */
export type SommeComptee = { montant: number | null; nb: number };

export type IndicateursStock = {
  valeurStock: number;
  /**
   * Prix en francs (2026-10-08) : `valeurStockApprox` = au moins un article en francs y est converti
   * au taux du jour (« ≈ ») ; `articlesSansTaux` = articles en francs NON valorisés faute de taux
   * (jamais comptés 0 en silence : l'écran le dit). Les articles en dollars : calcul inchangé.
   */
  valeurStockApprox: boolean;
  articlesSansTaux: number;
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

/**
 * `aujourdhui` : date des indicateurs INSTANTANÉS (stock, alertes, factures dues, semaine en cours).
 * `options.mois` ("AAAA-MM") : mois des indicateurs PAR PÉRIODE (légumes, consommation) ; par défaut
 * le mois de `aujourdhui` — l'appel sans option rend exactement les chiffres d'avant.
 */
export async function indicateursStock(aujourdhui: Date, options: { nbAlertes?: number; mois?: string } = {}): Promise<IndicateursStock> {
  const nbAlertes = options.nbAlertes ?? 5;
  // Bornes de dates en UTC (cohérent avec le stockage @db.Date) — mêmes calculs que l'accueil Stock.
  // `aujourdhui` est un INSTANT : le jour (donc la semaine et le mois) se lit à Kinshasa, comme les
  // dates des mouvements. Le serveur étant en UTC, le 1er du mois entre 00 h et 01 h il comptait
  // encore le mois (et la semaine) précédent.
  const jjUTC = jourCivilKinshasa(aujourdhui);
  const dow = jjUTC.getUTCDay(); // 0 = dimanche
  const lundi = new Date(jjUTC); lundi.setUTCDate(jjUTC.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const dimanche = new Date(lundi); dimanche.setUTCDate(lundi.getUTCDate() + 6);
  const [anneeP, mois0P] = options.mois
    ? [Number(options.mois.slice(0, 4)), Number(options.mois.slice(5, 7)) - 1]
    : [jjUTC.getUTCFullYear(), jjUTC.getUTCMonth()];
  const debutMois = new Date(Date.UTC(anneeP, mois0P, 1));
  const debutMoisSuivant = new Date(Date.UTC(anneeP, mois0P + 1, 1));

  const taux = await tauxDuJour();
  const [stocks, facturesDues, facturesSemaine, facturesEchues, legumesMois, consoMois] = await Promise.all([
    prisma.stock.findMany({ include: { article: { select: { designation: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } } } }),
    prisma.factureFournisseur.aggregate({ where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }, _sum: { resteAPayerUSD: true }, _count: true }),
    // Factures dont l'échéance tombe cette semaine (lun→dim), non réglées.
    prisma.factureFournisseur.aggregate({ where: { statut: { not: "REGLEE" }, dateEcheance: { gte: lundi, lte: dimanche } }, _sum: { resteAPayerUSD: true }, _count: true }),
    // Factures échues non réglées.
    prisma.factureFournisseur.aggregate({ where: { statut: "ECHUE_NON_REGLEE" }, _sum: { resteAPayerUSD: true }, _count: true }),
    // Achats de légumes frais du mois (en cours, ou celui de `options.mois`).
    prisma.achatLegume.aggregate({ where: { date: { gte: debutMois, lt: debutMoisSuivant } }, _sum: { montantUSD: true }, _count: true }),
    // Consommation du mois : sorties valorisées (montant saisi, sinon quantité × prix catalogue ; un
    // article en francs : quantité × francs ÷ taux du jour — rien sans taux, jamais 0).
    prisma.$queryRaw<{ total: number; n: number }[]>`
      SELECT COALESCE(SUM(COALESCE(m."montantUSD", m."quantite" * a."prixUnitaireUSD", m."quantite" * a."prixUnitaireCDF" / ${taux}::numeric)), 0)::float AS total, COUNT(*)::int AS n
      FROM "stock"."MouvementStock" m JOIN "stock"."ArticleStock" a ON a."id" = m."articleId"
      WHERE m."type" = 'SORTIE' AND m."date" >= ${debutMois} AND m."date" < ${debutMoisSuivant}`,
  ]);

  const avecAlerte = stocks.map((s) => ({
    articleId: s.articleId,
    designation: s.article.designation,
    quantite: Number(s.quantite),
    niveau: niveauAlerte(s.quantite, s.stockMinimum),
    // Article en dollars : calcul d'avant, à l'identique ; en francs : au taux du jour (« ≈ »).
    valeur: s.article.devisePrix === "CDF"
      ? valeurEnUSD(s.article, Number(s.quantite), taux)?.valeur ?? 0
      : s.article.prixUnitaireUSD ? Number(s.quantite) * Number(s.article.prixUnitaireUSD) : 0,
    enFrancs: s.article.devisePrix === "CDF" && s.article.prixUnitaireCDF !== null,
  }));
  const alertes: ArticleEnAlerte[] = avecAlerte
    .filter((a) => a.niveau === "URGENT" || a.niveau === "APPRO")
    .sort((a, b) => (a.niveau === "URGENT" ? 0 : 1) - (b.niveau === "URGENT" ? 0 : 1))
    .slice(0, nbAlertes)
    .map((a) => ({ articleId: a.articleId, designation: a.designation, quantite: a.quantite, niveau: a.niveau as "URGENT" | "APPRO" }));

  return {
    valeurStock: avecAlerte.reduce((t, a) => t + a.valeur, 0),
    valeurStockApprox: taux !== null && avecAlerte.some((a) => a.enFrancs),
    articlesSansTaux: taux === null ? avecAlerte.filter((a) => a.enFrancs).length : 0,
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
