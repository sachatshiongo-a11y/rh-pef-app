import "server-only";

// CŒUR DU CHANGEMENT DE DATE D'UNE SORTIE DE STOCK (demande de Sacha, 2026-10-08) — à l'unité ou en
// lot (id cochés, ou tout le filtre de la colonne Sorties). Hors fichier « use server » (voir
// reglement.ts) : l'action de l'écran Mouvements le garde (mêmes comptes que « Changer le motif ») puis
// l'appelle.
//
// Une CORRECTION de date, pas un mouvement : ni la quantité, ni le motif, ni `Stock.quantite` ne
// bougent ; la sortie garde son id. Tout ou rien : la moindre sortie fautive refuse le lot entier, en
// la NOMMANT, et rien n'est écrit. Refus :
//  - un mouvement qui n'est pas une SORTIE (entrée, ajustement de comptage, réception, facture, Liste
//    d'achat : leur date est portée par leur document) ;
//  - date vide, illisible ou future (jour civil de Kinshasa) ;
//  - ANCIENNE ou NOUVELLE date dans la période figée par la clôture du stock (`estDansPeriodeFigee` :
//    mois clôturé ou antérieur — l'instantané de clôture ne doit pas mentir) ;
//  - un COMPTAGE (session de comptage, ou mouvement d'AJUSTEMENT) du même article entre l'ancienne et
//    la nouvelle date, bornes INCLUSES (règle de la « saisie tardive inclusive ») : l'écart de ce
//    comptage a été calculé avec la sortie à sa date d'origine ; la déplacer de l'autre côté fausserait
//    le stock reconstitué ;
//  - une RÉCONCILIATION en attente de la Direction sur l'article (`COMPTAGE:<articleId>`).
// Chaque changement est journalisé (avant → après, auteur). Un compte non-Direction notifie la
// Direction (une notification par geste) — aujourd'hui l'action est réservée à la Direction, comme la
// requalification du motif : la notification ne part donc pas ; elle est prête si le droit s'ouvre.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliserPlusieurs } from "@/lib/audit";
import { estDansPeriodeFigee } from "@/lib/cloture-stock";
import type { SelectionMouvements } from "@/lib/filtre-mouvements";
import { DELAI_TOUT_LE_FILTRE, resoudreSelectionMouvements, type MvtSelection } from "@/lib/selection-mouvements";
import { MESSAGE_SORTIES_SEULES, datePureDe, jjmm, jjmmaaaa, jourISO, lireNouvelleDateSortie, natureNonSortie, nomsBornes } from "@/lib/date-sortie";
import { cleComptage } from "./charge";
import { notifierGesteStock, type AuteurGeste, type SortieRedatee } from "./geste-notifie";

type Tx = Prisma.TransactionClient;

export type ResultatDateSorties = { n: number; deja: number; date: string; avertissement?: string } | { erreur: string; nouveauNombre?: number };

const RIEN = "Date non changée : rien n'a été modifié.";
const periodeDe = (b: { annee: number; mois: number }) => `${String(b.mois).padStart(2, "0")}/${b.annee}`;
const sortieNommee = (m: MvtSelection) => `${m.article.designation} du ${jjmm(m.date)}`;

/**
 * Contrôles et écriture, DANS la transaction. Renvoie les sorties réellement redatées (pour la
 * notification) et le nombre déjà à cette date, ou un refus lisible (rien d'écrit).
 */
export async function changerDateSortiesTx(tx: Tx, userId: string, selection: SelectionMouvements, nouvelle: Date):
  Promise<{ changees: SortieRedatee[]; deja: number; avertissement?: string } | { erreur: string; nouveauNombre?: number }> {
  const res = await resoudreSelectionMouvements(tx, selection, "sorties", "Cochez au moins une sortie.");
  if ("erreur" in res) return res;
  if (res.mvs.length !== res.nbDemandes) return { erreur: "Certaines sorties n'existent plus : rechargez la page." };

  // 1. Seules les sorties.
  const autres = res.mvs.filter((m) => m.type !== "SORTIE");
  if (autres.length > 0) {
    return { erreur: `${MESSAGE_SORTIES_SEULES} À décocher : ${nomsBornes(autres.map((m) => `${m.article.designation} du ${jjmm(m.date)} (${natureNonSortie(m)})`))}.` };
  }

  // 2. Verrous : les lignes de stock des articles (un comptage les verrouille aussi : aucun ne s'écrit
  //    entre nos contrôles et l'écriture), puis les sorties elles-mêmes (ni supprimées ni redatées en même temps).
  const articleIds = [...new Set(res.mvs.map((m) => m.articleId))].sort();
  await tx.$queryRaw`SELECT "id" FROM "stock"."Stock" WHERE "articleId" IN (${Prisma.join(articleIds)}) ORDER BY "articleId" FOR UPDATE`;
  const ids = res.mvs.map((m) => m.id).sort();
  const verrouillees = await tx.$queryRaw<{ id: string; date: Date }[]>`SELECT "id", "date" FROM "stock"."MouvementStock" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  if (verrouillees.length !== ids.length) return { erreur: "Certaines sorties n'existent plus : rechargez la page." };
  const dateVerrouillee = new Map(verrouillees.map((v) => [v.id, jourISO(new Date(v.date))]));
  if (res.mvs.some((m) => dateVerrouillee.get(m.id) !== jourISO(m.date))) return { erreur: "Une de ces sorties vient d'être modifiée : rechargez la page." };

  const cible = jourISO(nouvelle);
  const aChanger = res.mvs.filter((m) => jourISO(m.date) !== cible);
  const deja = res.mvs.length - aChanger.length;
  if (aChanger.length === 0) return { changees: [], deja };

  // 3. Période figée par la clôture : l'ancienne date comme la nouvelle.
  const borne = await tx.clotureStock.findFirst({ orderBy: [{ annee: "desc" }, { mois: "desc" }], select: { annee: true, mois: true } });
  if (borne && estDansPeriodeFigee(nouvelle, borne)) {
    return { erreur: `La période ${periodeDe(borne)} est clôturée : le stock est figé jusqu'à ce mois inclus, aucune sortie ne peut être datée du ${jjmmaaaa(nouvelle)}. ${RIEN} (Direction : Paramètres → Clôture mensuelle pour rouvrir les mois concernés.)` };
  }
  const figees = borne ? aChanger.filter((m) => estDansPeriodeFigee(m.date, borne)) : [];
  if (borne && figees.length > 0) {
    return { erreur: `La période ${periodeDe(borne)} est clôturée : le stock est figé jusqu'à ce mois inclus, la date de ces sorties ne peut plus changer — ${nomsBornes(figees.map(sortieNommee))}. ${RIEN} (Direction : Paramètres → Clôture mensuelle pour rouvrir les mois concernés.)` };
  }

  // 4. Comptage entre l'ancienne et la nouvelle date (bornes incluses), même article.
  const bornesDe = (m: MvtSelection): [Date, Date] => (m.date < nouvelle ? [m.date, nouvelle] : [nouvelle, m.date]);
  const lo = aChanger.reduce((x, m) => (bornesDe(m)[0] < x ? bornesDe(m)[0] : x), nouvelle);
  const hi = aChanger.reduce((x, m) => (bornesDe(m)[1] > x ? bornesDe(m)[1] : x), nouvelle);
  const idsChanger = [...new Set(aChanger.map((m) => m.articleId))];
  const [lignesComptage, ajustements, enAttente] = await Promise.all([
    tx.ligneComptage.findMany({ where: { articleId: { in: idsChanger }, session: { date: { gte: lo, lte: hi } } }, select: { articleId: true, session: { select: { date: true } } } }),
    tx.mouvementStock.findMany({ where: { type: "AJUSTEMENT", articleId: { in: idsChanger }, date: { gte: lo, lte: hi } }, select: { articleId: true, date: true } }),
    tx.cibleDemandeStock.findMany({ where: { cle: { in: idsChanger.map(cleComptage) }, demande: { statut: "EN_ATTENTE" } }, select: { cle: true } }),
  ]);
  const comptages = [
    ...lignesComptage.flatMap((l) => (l.articleId ? [{ articleId: l.articleId, date: l.session.date }] : [])),
    ...ajustements,
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const fautesComptage: string[] = [];
  for (const m of aChanger) {
    const [a, b] = bornesDe(m);
    const c = comptages.find((x) => x.articleId === m.articleId && x.date >= a && x.date <= b);
    if (c) fautesComptage.push(`${sortieNommee(m)} (comptage du ${jjmm(c.date)})`);
  }
  const reconciliees = new Set(enAttente.map((c) => c.cle));
  const fautesDemande = aChanger.filter((m) => reconciliees.has(cleComptage(m.articleId))).map(sortieNommee);
  if (fautesComptage.length > 0 || fautesDemande.length > 0) {
    const parties = [
      fautesComptage.length > 0
        ? `Un comptage du même article tombe entre l'ancienne et la nouvelle date (l'écart de ce comptage a été calculé avec la sortie à sa date d'origine : la déplacer fausserait le stock reconstitué) — ${nomsBornes(fautesComptage)}.`
        : null,
      fautesDemande.length > 0
        ? `Une réconciliation de l'article attend la décision de la Direction (« Demandes à valider ») — ${nomsBornes(fautesDemande)}.`
        : null,
    ].filter(Boolean);
    return { erreur: `${RIEN} ${parties.join(" ")}` };
  }

  // 5. Comptage du RESTAURANT entre les deux dates (avertissement, NON bloquant). Le stock théorique du
  //    restaurant = dernier comptage résto + livraisons du dépôt datées APRÈS lui : une livraison redatée
  //    de l'autre côté d'un comptage résto change ce stock (et la consommation réelle). C'est souvent
  //    précisément la correction voulue (livraison saisie au mauvais jour, le restaurant compte chaque
  //    jour) : refuser la rendrait impossible. Le geste est donc écrit, et l'écart est NOMMÉ.
  const livraisons = aChanger.filter((m) => m.categorieSortie === "LIVRAISON_RESTAURANT");
  let avertissement: string | undefined;
  if (livraisons.length > 0) {
    const comptesResto = await tx.comptageResto.findMany({
      where: { date: { gte: lo, lte: hi }, article: { articleStockId: { in: [...new Set(livraisons.map((m) => m.articleId))] } } },
      select: { date: true, article: { select: { articleStockId: true } } },
      orderBy: { date: "asc" },
    });
    const touchees = livraisons.flatMap((m) => {
      const [a, b] = bornesDe(m);
      const c = comptesResto.find((x) => x.article.articleStockId === m.articleId && x.date >= a && x.date <= b);
      return c ? [`${sortieNommee(m)} (compté au restaurant le ${jjmm(c.date)})`] : [];
    });
    if (touchees.length > 0) {
      avertissement = `Attention, stock du restaurant : la livraison passe de l'autre côté d'un comptage du restaurant — ${nomsBornes(touchees)}. Le stock théorique du restaurant et la consommation réelle de ces jours changent en conséquence (vérifiez-les dans Conso. journalière).`;
    }
  }

  // 6. Écriture : la date seule (quantité, motif, id inchangés), puis le journal (avant → après).
  const maj = await tx.mouvementStock.updateMany({ where: { id: { in: aChanger.map((m) => m.id) }, type: "SORTIE" }, data: { date: nouvelle } });
  if (maj.count !== aChanger.length) throw new Error("Une de ces sorties vient d'être modifiée : rechargez la page.");
  await journaliserPlusieurs(tx, aChanger.map((m) => ({
    entite: "MouvementStock", entiteId: m.id, champ: "date", ancienneValeur: jourISO(m.date), nouvelleValeur: cible, userId,
  })));
  return {
    changees: aChanger.map((m) => ({
      articleId: m.articleId, designation: m.article.designation, unite: m.article.unite, quantite: Number(m.quantite),
      ancienne: m.date, categorieSortie: m.categorieSortie,
    })),
    deja,
    ...(avertissement ? { avertissement } : {}),
  };
}

/**
 * Change la date des sorties sélectionnées. La garde de DROIT est celle de l'action qui l'appelle ;
 * ici : la date, les contrôles, l'écriture en une transaction, puis — APRÈS, jamais bloquante — la
 * notification de la Direction (rien si l'auteur est la Direction).
 */
export async function appliquerChangementDateSorties(auteur: AuteurGeste, selection: SelectionMouvements, saisie: unknown, maintenant: Date = new Date()): Promise<ResultatDateSorties> {
  const iso = lireNouvelleDateSortie(saisie, maintenant);
  if (!Array.isArray(selection) && selection?.colonne !== "SORTIES") return { erreur: MESSAGE_SORTIES_SEULES };
  const nouvelle = datePureDe(iso);
  const r = await prisma.$transaction((tx) => changerDateSortiesTx(tx, auteur.id, selection, nouvelle), { timeout: DELAI_TOUT_LE_FILTRE });
  if ("erreur" in r) return r;
  if (r.changees.length > 0) await notifierGesteStock(auteur, { genre: "DATE_SORTIE", nouvelle, sorties: r.changees }, maintenant);
  return { n: r.changees.length, deja: r.deja, date: iso, ...(r.avertissement ? { avertissement: r.avertissement } : {}) };
}
