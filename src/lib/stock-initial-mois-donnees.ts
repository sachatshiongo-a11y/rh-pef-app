import "server-only";
import { prisma } from "@/lib/prisma";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { inventaireFige } from "@/lib/cloture-inventaire";
import {
  debutMoisKinshasa, jourDebutMois, jourDebutMoisSuivant, moisPrecedent, resoudreAjustements,
  type DonneesStockInitial, type MouvementsAgreges,
} from "@/lib/stock-initial-mois";

// CHARGEUR du stock initial d'un mois (règles : `stock-initial-mois.ts`). Le coût est BORNÉ, indépendant du nombre
// d'articles (446 au catalogue, un serveur à 0,1 vCPU) : des agrégats (`groupBy` par article et par type), jamais
// une requête par article. Au plus ~9 lectures : deux agrégats du mois (dans le mois / après), les articles créés
// depuis le 1er, leurs mouvements d'avant (si besoin), les imports d'inventaire, et — seulement s'il y en a — les
// ajustements de comptage (2 lectures) et la clôture du mois précédent (1 lecture + 1 agrégat).

type Agregat = { articleId: string; type: string; _sum: { quantite: { toString(): string } | null }; _count: { _all: number } };

/** Agrégats de groupBy → une entrée par article ; le sens des ajustements est posé plus tard (null tant qu'il n'est pas résolu). */
function agregerParArticle(groupes: readonly Agregat[]): Map<string, MouvementsAgreges> {
  const r = new Map<string, MouvementsAgreges>();
  for (const g of groupes) {
    const cur = r.get(g.articleId) ?? { entrees: "0", sorties: "0", ajustements: { nb: 0, net: null } };
    const q = g._sum.quantite?.toString() ?? "0";
    if (g.type === "ENTREE") cur.entrees = q;
    else if (g.type === "SORTIE") cur.sorties = q;
    else cur.ajustements = { nb: g._count._all, net: null };
    r.set(g.articleId, cur);
  }
  // Pas d'ajustement dans la fenêtre : le net est 0, pas « inconnu ».
  for (const m of r.values()) if (m.ajustements.nb === 0) m.ajustements = { nb: 0, net: 0 };
  return r;
}

const nbAjustements = (...cartes: Map<string, MouvementsAgreges>[]) => cartes.reduce((n, c) => n + [...c.values()].reduce((t, m) => t + m.ajustements.nb, 0), 0);

/**
 * Données du stock initial du mois `annee`/`mois`.
 * `figeLe` : mois clôturé — le stock de fin est l'instantané pris à cet instant, donc seuls les mouvements DÉJÀ
 * enregistrés (`createdAt` ≤ `figeLe`) sont à retirer. Absent : stock actuel, tous les mouvements.
 */
export async function chargerDonneesStockInitial(annee: number, mois: number, { figeLe }: { figeLe?: Date } = {}): Promise<DonneesStockInitial> {
  const debut = debutMoisKinshasa(annee, mois);
  const jour1 = jourDebutMois(annee, mois), jourFin = jourDebutMoisSuivant(annee, mois);
  const enregistres = figeLe ? { createdAt: { lte: figeLe } } : {};
  const agreger = (date: { gte: Date; lt?: Date }, plus: object = enregistres) =>
    prisma.mouvementStock.groupBy({ by: ["articleId", "type"], where: { date, ...plus }, _sum: { quantite: true }, _count: { _all: true } });

  const precedent = moisPrecedent(annee, mois);
  const [dansGroupes, apresGroupes, crees, imports, cloture] = await Promise.all([
    agreger({ gte: jour1, lt: jourFin }),
    agreger({ gte: jourFin }),
    prisma.articleStock.findMany({ where: { createdAt: { gte: debut, ...(figeLe ? { lte: figeLe } : {}) } }, select: { id: true, createdAt: true } }),
    // Import d'INVENTAIRE depuis le 1er : stock posé en absolu, mouvements de journal sans effet → l'article n'est pas reconstituable.
    prisma.importOperation.findMany({
      where: { entite: "Stock", batch: { type: "INVENTAIRE", ...(figeLe ? { createdAt: { lte: figeLe } } : {}), OR: [{ createdAt: { gte: debut } }, { annuleeAt: { gte: debut } }] } },
      select: { entiteId: true, batch: { select: { createdAt: true } } },
    }),
    inventaireFige(precedent.annee, precedent.mois),
  ]);

  const dansMois = agregerParArticle(dansGroupes as Agregat[]);
  const apresMois = agregerParArticle(apresGroupes as Agregat[]);

  // Clôture du mois précédent : ses mouvements (date ≥ 1er) déjà enregistrés à son instant, pour ramener l'instantané au 1er.
  let cloturePrecedente: DonneesStockInitial["cloturePrecedente"];
  let mvtCloture: Map<string, MouvementsAgreges> | undefined;
  if (cloture?.figeLe) {
    const groupes = await agreger({ gte: jour1 }, { createdAt: { lte: cloture.figeLe } });
    mvtCloture = agregerParArticle(groupes as Agregat[]);
    cloturePrecedente = {
      annee: precedent.annee, mois: precedent.mois, figeLe: cloture.figeLe,
      stocks: new Map(cloture.lignes.map((l) => [l.articleId, l.quantite])), mouvements: mvtCloture,
    };
  }

  // Sens des ajustements : seulement s'il y en a (cas courant : aucun comptage, aucune lecture de plus).
  if (nbAjustements(dansMois, apresMois, ...(mvtCloture ? [mvtCloture] : [])) > 0) {
    // Mois clôturé : rien d'enregistré après l'instantané (borne haute, la plus tardive des deux clôtures en jeu) ; sinon aucune borne — la fenêtre de la clôture précédente est filtrée en mémoire.
    const borne = figeLe ? (cloture?.figeLe && cloture.figeLe > figeLe ? cloture.figeLe : figeLe) : undefined;
    const [ajustements, lignes] = await Promise.all([
      prisma.mouvementStock.findMany({ where: { type: "AJUSTEMENT", date: { gte: jour1 }, ...(borne ? { createdAt: { lte: borne } } : {}) }, select: { articleId: true, quantite: true, date: true, createdAt: true } }),
      prisma.ligneComptage.findMany({
        where: { articleId: { not: null }, NOT: { ecart: 0 }, session: { createdAt: { gte: debut, ...(borne ? { lte: borne } : {}) } } },
        select: { articleId: true, ecart: true, session: { select: { createdAt: true } } },
      }),
    ]);
    // Une ligne de comptage a le jour civil et l'instant de sa session : mêmes critères de fenêtre que le mouvement qu'elle a produit.
    const lignesJ = lignes.map((l) => ({ articleId: l.articleId!, ecart: l.ecart.toString(), jour: jourCivilKinshasa(l.session.createdAt), instant: l.session.createdAt }));
    // Index par article, construits UNE fois : le calcul reste linéaire (jamais « articles × ajustements »).
    const parArticle = <T extends { articleId: string }>(liste: readonly T[]) => {
      const r = new Map<string, T[]>();
      for (const x of liste) { const l = r.get(x.articleId); if (l) l.push(x); else r.set(x.articleId, [x]); }
      return r;
    };
    const ajustementsDe = parArticle(ajustements), lignesDe = parArticle(lignesJ);
    const fixer = (carte: Map<string, MouvementsAgreges>, dans: (jour: Date, instant: Date) => boolean) => {
      for (const [articleId, m] of carte) {
        if (m.ajustements.nb === 0) continue;
        const mv = (ajustementsDe.get(articleId) ?? []).filter((x) => dans(x.date, x.createdAt)).map((x) => ({ quantite: x.quantite.toString() }));
        const li = (lignesDe.get(articleId) ?? []).filter((x) => dans(x.jour, x.instant)).map((x) => ({ ecart: x.ecart }));
        m.ajustements = resoudreAjustements(mv, li);
      }
    };
    const avantFige = (t: Date) => !figeLe || t <= figeLe;
    fixer(dansMois, (j, t) => j >= jour1 && j < jourFin && avantFige(t));
    fixer(apresMois, (j, t) => j >= jourFin && avantFige(t));
    if (mvtCloture && cloture?.figeLe) { const cap = cloture.figeLe; fixer(mvtCloture, (j, t) => j >= jour1 && t <= cap); }
  }

  const idsCrees = crees.map((a) => a.id);
  const avant = idsCrees.length > 0
    ? await prisma.mouvementStock.groupBy({ by: ["articleId"], where: { articleId: { in: idsCrees }, date: { lt: jour1 } }, _count: { _all: true } })
    : [];

  const horsMouvement = new Map<string, string>();
  for (const o of imports) {
    if (!horsMouvement.has(o.entiteId)) horsMouvement.set(o.entiteId, `stock posé par un import d'inventaire (${jourCivilKinshasa(o.batch.createdAt).toISOString().slice(0, 10).split("-").reverse().join("/")}) : il n'est pas reconstituable par les mouvements`);
  }

  return {
    annee, mois, debut, ...(figeLe ? { figeLe } : {}),
    dansMois, apresMois,
    crees: new Map(crees.map((a) => [a.id, a.createdAt])),
    avecMouvementAvant: new Set(avant.map((g) => g.articleId)),
    horsMouvement,
    ...(cloturePrecedente ? { cloturePrecedente } : {}),
  };
}
