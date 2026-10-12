import "server-only";

import { prixSaisi, valeurEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { prisma } from "@/lib/prisma";
import { niveauAlerte } from "@/lib/stock";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";

// Indicateurs du Stock partagés : UNE seule source de vérité pour l'accueil Stock et le tableau de
// bord de l'Exploitation. Formules recopiées à l'identique de l'accueil Stock (un test de
// non-régression le prouve) ; les alertes passent par `niveauAlerte`, sans rien changer à sa règle.

export type ArticleEnAlerte = { articleId: string; designation: string; quantite: number; niveau: "URGENT" | "APPRO" };

/**
 * `montant` : null quand il n'y a rien à sommer (l'accueil affiche alors « — », jamais « 0,00 $ »).
 * `montantCDF` (factures, 2026-10-09) : la part des factures tenues en FRANCS, à part — jamais
 * additionnée aux dollars (`montant` reste la somme des seules factures en dollars, comme avant).
 */
export type SommeComptee = { montant: number | null; nb: number; montantCDF?: number | null };

export type IndicateursStock = {
  valeurStock: number;
  /**
   * Prix en francs (2026-10-08) : `valeurStockApprox` = au moins un article en francs y est converti
   * au taux du jour (« ≈ ») ; `articlesSansTaux` = articles en francs NON valorisés faute de taux
   * (jamais comptés 0 en silence : l'écran le dit). Les articles en dollars : calcul inchangé.
   */
  valeurStockApprox: boolean;
  articlesSansTaux: number;
  /**
   * Articles ACTIFS en stock SANS prix (2026-10-10) : leur valeur est inconnue, pas nulle. La valeur du stock est
   * partielle d'eux — l'écran le dit (« partiel : N sans prix »), jamais un zéro muet. (Un article en francs sans
   * taux est compté à part, `articlesSansTaux`.)
   */
  valeurStockSansPrix: number;
  nbUrgent: number;
  nbAppro: number;
  /** Urgents d'abord, puis à réapprovisionner ; tronqué à `nbAlertes`. */
  alertes: ArticleEnAlerte[];
  facturesAPayer: SommeComptee;
  facturesSemaine: SommeComptee;
  facturesEchues: SommeComptee;
  legumesMois: SommeComptee;
  /**
   * Consommation du mois = sorties du mois. `montant` et `nb` ne portent que les sorties VALORISÉES ; `nbSansPrix`
   * compte les autres (ni montant saisi, ni prix : valeur inconnue, jamais comptée 0) — la consommation est alors
   * partielle. Détail par motif : livraisons au restaurant et pertes ne sont pas la même chose ; `sansMotif` = les
   * sorties anciennes sans motif. montant = livraisons + pertes + sansMotif.
   */
  consoMois: { montant: number; nb: number; nbSansPrix: number; livraisons: PartConso; pertes: PartConso; sansMotif: PartConso };
  /** Sorties du mois d'articles au prix en francs NON valorisées faute de taux (comprises dans `consoMois.nbSansPrix`). */
  consoFrancsSansTaux: number;
};

export type PartConso = { montant: number; nb: number; nbSansPrix: number };

const somme = (agg: { _sum: Record<string, unknown>; _count: number }, champ: string, champCDF?: string): SommeComptee => {
  const v = agg._sum[champ];
  const c = champCDF ? agg._sum[champCDF] : undefined;
  return { montant: v === null || v === undefined ? null : Number(v), nb: agg._count, ...(champCDF ? { montantCDF: c === null || c === undefined ? null : Number(c) } : {}) };
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
    prisma.stock.findMany({ where: { article: { actif: true } }, include: { article: { select: { ...CHAMPS_LIBELLE, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } } } }),
    prisma.factureFournisseur.aggregate({ where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }, _sum: { resteAPayerUSD: true, resteAPayerCDF: true }, _count: true }),
    // Factures dont l'échéance tombe cette semaine (lun→dim), non réglées.
    prisma.factureFournisseur.aggregate({ where: { statut: { not: "REGLEE" }, dateEcheance: { gte: lundi, lte: dimanche } }, _sum: { resteAPayerUSD: true, resteAPayerCDF: true }, _count: true }),
    // Factures échues non réglées.
    prisma.factureFournisseur.aggregate({ where: { statut: "ECHUE_NON_REGLEE" }, _sum: { resteAPayerUSD: true, resteAPayerCDF: true }, _count: true }),
    // Achats de légumes frais du mois (en cours, ou celui de `options.mois`).
    prisma.achatLegume.aggregate({ where: { date: { gte: debutMois, lt: debutMoisSuivant } }, _sum: { montantUSD: true }, _count: true }),
    // Consommation du mois, PAR MOTIF : sorties valorisées (montant saisi, sinon quantité × prix catalogue ; un
    // article en francs : quantité × francs ÷ taux du jour). Une sortie sans valeur (ni montant, ni prix, ni taux)
    // n'est PAS comptée 0 : elle est comptée à part (`nbsp`), la consommation est alors annoncée partielle.
    prisma.$queryRaw<{ motif: string | null; total: number; nv: number; nsp: number; nfc: number }[]>`
      SELECT s.motif, COALESCE(SUM(s.v), 0)::float AS total, COUNT(s.v)::int AS nv, COUNT(*) FILTER (WHERE s.v IS NULL)::int AS nsp,
        COUNT(*) FILTER (WHERE s.v IS NULL AND s.fc)::int AS nfc
      FROM (
        SELECT m."categorieSortie"::text AS motif,
          COALESCE(m."montantUSD", m."quantite" * a."prixUnitaireUSD", m."quantite" * a."prixUnitaireCDF" / ${taux}::numeric) AS v,
          (m."montantUSD" IS NULL AND a."prixUnitaireCDF" IS NOT NULL AND ${taux}::numeric IS NULL) AS fc
        FROM "stock"."MouvementStock" m JOIN "stock"."ArticleStock" a ON a."id" = m."articleId"
        WHERE m."type" = 'SORTIE' AND m."date" >= ${debutMois} AND m."date" < ${debutMoisSuivant}
      ) s GROUP BY s.motif`,
  ]);

  const avecAlerte = stocks.map((s) => ({
    articleId: s.articleId,
    designation: libelleArticle(s.article), // nom affiché des alertes (contenance comprise)
    quantite: Number(s.quantite),
    niveau: niveauAlerte(s.quantite, s.stockMinimum, s.seuilUrgent),
    // Article en dollars : calcul d'avant, à l'identique ; en francs : au taux du jour (« ≈ »).
    valeur: s.article.devisePrix === "CDF"
      ? valeurEnUSD(s.article, Number(s.quantite), taux)?.valeur ?? 0
      : s.article.prixUnitaireUSD ? Number(s.quantite) * Number(s.article.prixUnitaireUSD) : 0,
    sansPrix: Number(s.quantite) !== 0 && prixSaisi(s.article) === null,
    enFrancs: s.article.devisePrix === "CDF" && s.article.prixUnitaireCDF !== null,
  }));
  const alertes: ArticleEnAlerte[] = avecAlerte
    .filter((a) => a.niveau === "URGENT" || a.niveau === "APPRO")
    .sort((a, b) => (a.niveau === "URGENT" ? 0 : 1) - (b.niveau === "URGENT" ? 0 : 1))
    .slice(0, nbAlertes)
    .map((a) => ({ articleId: a.articleId, designation: a.designation, quantite: a.quantite, niveau: a.niveau as "URGENT" | "APPRO" }));

  // « Sans motif » = tout ce qui n'est ni livraison ni perte (sorties anciennes : le motif est obligatoire depuis 2026-10-07).
  const part = (garde: (motif: string | null) => boolean): PartConso => {
    const rs = consoMois.filter((x) => garde(x.motif));
    return { montant: rs.reduce((t, r) => t + r.total, 0), nb: rs.reduce((t, r) => t + r.nv, 0), nbSansPrix: rs.reduce((t, r) => t + r.nsp, 0) };
  };
  const livraisons = part((m) => m === "LIVRAISON_RESTAURANT"), pertes = part((m) => m === "PERTE");
  const sansMotif = part((m) => m !== "LIVRAISON_RESTAURANT" && m !== "PERTE");
  const conso = {
    montant: livraisons.montant + pertes.montant + sansMotif.montant,
    nb: livraisons.nb + pertes.nb + sansMotif.nb,
    nbSansPrix: livraisons.nbSansPrix + pertes.nbSansPrix + sansMotif.nbSansPrix,
    livraisons, pertes, sansMotif,
  };

  return {
    valeurStock: avecAlerte.reduce((t, a) => t + a.valeur, 0),
    valeurStockApprox: taux !== null && avecAlerte.some((a) => a.enFrancs),
    articlesSansTaux: taux === null ? avecAlerte.filter((a) => a.enFrancs).length : 0,
    valeurStockSansPrix: avecAlerte.filter((a) => a.sansPrix).length,
    nbUrgent: avecAlerte.filter((a) => a.niveau === "URGENT").length,
    nbAppro: avecAlerte.filter((a) => a.niveau === "APPRO").length,
    alertes,
    facturesAPayer: somme(facturesDues, "resteAPayerUSD", "resteAPayerCDF"),
    facturesSemaine: somme(facturesSemaine, "resteAPayerUSD", "resteAPayerCDF"),
    facturesEchues: somme(facturesEchues, "resteAPayerUSD", "resteAPayerCDF"),
    legumesMois: somme(legumesMois, "montantUSD"),
    consoMois: conso,
    consoFrancsSansTaux: consoMois.reduce((t, r) => t + r.nfc, 0),
  };
}
