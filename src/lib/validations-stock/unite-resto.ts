import "server-only";

// ALIGNER L'UNITÉ D'UN ARTICLE DU RESTAURANT SUR CELLE DE L'INVENTAIRE — un seul chemin d'écriture pour
// le geste direct de la Direction ET pour la validation d'une demande (nature UNITE_RESTO). Règle de la
// Direction (2026-10-12) : UNE seule unité par produit, celle de l'Inventaire. Rien n'est converti en
// silence : l'alignement est un geste confirmé qui montre son effet ; il change l'unité de l'article du
// restaurant ET convertit, par le facteur EXACT (Decimal), ses comptages et son stock de base — dans UNE
// transaction, journalisé avant → après. Refusé si la conversion est impossible ou ne tient pas dans la
// précision de la base (3 décimales).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { formaterNombre } from "@/lib/montant";
import { libelleArticle } from "@/lib/libelle-article";
import { convertirQuantite, ecartUnite, libelleFacteur, type EcartUnite } from "@/lib/unite-resto";
import type { ArticleUniteResto } from "./charge";
import { ErreurMetier } from "@/lib/erreur-metier";

type Tx = Prisma.TransactionClient;

/** L'état des lieux a changé depuis le plan (ou la demande) : rien n'est écrit. */
export class ConflitUnite extends ErreurMetier {}

export type PlanAlignement = {
  ecart: EcartUnite;
  nbComptages: number;
  /** Dernier comptage, avant → après (null : aucun). */
  exemple: { date: string; avant: string; apres: string } | null;
  stockBase: { avant: string; apres: string } | null;
};

const jour = (d: Date) => d.toISOString().slice(0, 10);
const nb = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 6 });

/** Écart d'unité des articles du restaurant rattachés (ceux de `ids`, sinon tous), avec l'effet sur les données. */
export async function plansAlignement(client: Tx | typeof prisma, opts: { ids?: string[]; actifsSeulement?: boolean } = {}): Promise<PlanAlignement[]> {
  const restos = await client.articleResto.findMany({
    where: { liens: { some: {} }, ...(opts.ids ? { id: { in: opts.ids } } : {}), ...(opts.actifsSeulement ? { actif: true } : {}) },
    orderBy: [{ espace: "asc" }, { ordre: "asc" }, { designation: "asc" }],
    select: {
      id: true, designation: true, espace: true, unite: true, stockBaseJournalier: true,
      liens: { select: { articleStock: { select: { id: true, designation: true, unite: true, contenance: true, contenanceUnite: true } } } },
      _count: { select: { comptages: true } },
      comptages: { orderBy: { date: "desc" }, take: 1, select: { date: true, quantite: true } },
    },
  });
  const plans: PlanAlignement[] = [];
  for (const r of restos) {
    const lies = r.liens.map((l) => ({ id: l.articleStock.id, unite: l.articleStock.unite, designation: libelleArticle(l.articleStock), contenance: l.articleStock.contenance?.toString() ?? null, contenanceUnite: l.articleStock.contenanceUnite }));
    const ecart = ecartUnite(r, lies, r._count.comptages > 0);
    if (!ecart) continue;
    let exemple: PlanAlignement["exemple"] = null, stockBase: PlanAlignement["stockBase"] = null;
    if (ecart.etat === "ALIGNABLE") {
      const c = r.comptages[0];
      if (c) exemple = { date: jour(c.date), avant: c.quantite.toString(), apres: convertirQuantite(c.quantite, ecart.facteurNum, ecart.facteurDen).valeur };
      if (r.stockBaseJournalier !== null) stockBase = { avant: r.stockBaseJournalier.toString(), apres: convertirQuantite(r.stockBaseJournalier, ecart.facteurNum, ecart.facteurDen).valeur };
    }
    plans.push({ ecart, nbComptages: r._count.comptages, exemple, stockBase });
  }
  return plans;
}

/** L'effet d'un alignement, en clair (« 4,5 kg → 4 500 g sur 12 comptage(s) »), pour la confirmation et la demande. */
export function texteEffet(p: PlanAlignement): string {
  const e = p.ecart;
  if (e.etat !== "ALIGNABLE") return `« ${e.designation} » : non convertible — ${e.raison}.`;
  const de = e.uniteResto?.trim() || "—", vers = e.uniteInventaire!;
  const parties = [
    p.nbComptages === 0 ? "aucun comptage à convertir" : `${p.nbComptages} comptage(s) convertis${p.exemple ? ` (dernier : ${nb(p.exemple.avant)} ${de} → ${nb(p.exemple.apres)} ${vers})` : ""}`,
    p.stockBase ? `stock de base ${nb(p.stockBase.avant)} ${de} → ${nb(p.stockBase.apres)} ${vers}` : null,
  ].filter(Boolean);
  return `« ${e.designation} » : ${de} → ${vers} (${libelleFacteur(e.facteurNum, e.facteurDen)}) — ${parties.join(" ; ")}.`;
}

/** La charge d'une demande pour ces plans (tous alignables). */
export function articlesDeDemande(plans: PlanAlignement[]): ArticleUniteResto[] {
  return plans.flatMap((p) => p.ecart.etat !== "ALIGNABLE" ? [] : [{
    articleRestoId: p.ecart.articleRestoId, designation: p.ecart.designation, espace: p.ecart.espace,
    uniteAvant: p.ecart.uniteResto, uniteApres: p.ecart.uniteInventaire!, facteurNum: p.ecart.facteurNum, facteurDen: p.ecart.facteurDen, nbComptages: p.nbComptages,
  }]);
}

/**
 * Ce qui a changé depuis un plan ou une demande (liste vide : on peut exécuter). Les MÊMES constats servent
 * au geste direct, à l'aperçu de la Direction et à la validation (demande périmée).
 */
export async function obstaclesAlignement(client: Tx | typeof prisma, articles: ArticleUniteResto[]): Promise<string[]> {
  const plans = new Map((await plansAlignement(client, { ids: articles.map((a) => a.articleRestoId) })).map((p) => [p.ecart.articleRestoId, p]));
  const manquants: string[] = [];
  for (const a of articles) {
    const p = plans.get(a.articleRestoId);
    if (!p) { manquants.push(`« ${a.designation} » n'a plus d'écart d'unité avec l'Inventaire (déjà aligné, détaché ou supprimé)`); continue; }
    const e = p.ecart;
    if (e.etat !== "ALIGNABLE") { manquants.push(`« ${a.designation} » : non convertible — ${e.raison}`); continue; }
    if ((e.uniteResto ?? null) !== a.uniteAvant || e.uniteInventaire !== a.uniteApres || e.facteurNum !== a.facteurNum || e.facteurDen !== a.facteurDen) {
      manquants.push(`« ${a.designation} » : l'unité ou l'Inventaire a changé depuis (${e.uniteResto ?? "—"} → ${e.uniteInventaire}) — l'effet n'est plus celui demandé`);
    }
  }
  return manquants;
}

/**
 * Écrit l'alignement (déjà contrôlé par `obstaclesAlignement`) : unité de l'article du restaurant, comptages
 * et stock de base convertis par le facteur exact. Refuse, sans rien écrire, une conversion qui ne tient pas en
 * 3 décimales (ex. 4,5 g → 0,0045 kg) : le logiciel n'arrondit jamais un comptage en silence.
 */
export async function aligner(tx: Tx, userId: string, articles: ArticleUniteResto[], suffixe = ""): Promise<{ articles: number; comptages: number }> {
  const journal: EntreeJournal[] = [];
  let nbComptages = 0;
  for (const a of articles) {
    const resto = await tx.articleResto.findUnique({ where: { id: a.articleRestoId }, select: { unite: true, stockBaseJournalier: true } });
    if (!resto || (resto.unite ?? null) !== a.uniteAvant) throw new ConflitUnite(`« ${a.designation} » : l'unité a changé depuis — rien n'a été écrit`);
    const comptages = await tx.comptageResto.findMany({ where: { articleRestoId: a.articleRestoId }, select: { id: true, date: true, quantite: true } });
    const nouveaux = comptages.map((c) => ({ c, ...convertirQuantite(c.quantite, a.facteurNum, a.facteurDen) }));
    const trop = nouveaux.filter((x) => !x.exact);
    const base = resto.stockBaseJournalier === null ? null : convertirQuantite(resto.stockBaseJournalier, a.facteurNum, a.facteurDen);
    if (trop.length > 0 || (base !== null && !base.exact)) {
      const ex = trop[0];
      throw new Error(`« ${a.designation} » : ${trop.length || 1} valeur(s) ne tiennent pas en 3 décimales après conversion${ex ? ` (ex. ${nb(ex.c.quantite.toString())} ${a.uniteAvant ?? ""} → ${nb(ex.valeur)} ${a.uniteApres})` : " (stock de base)"} — rien n'a été écrit. Alignez dans l'autre sens (changez l'unité de l'Inventaire) ou corrigez ces valeurs.`);
    }
    for (const x of nouveaux) {
      await tx.comptageResto.update({ where: { id: x.c.id }, data: { quantite: x.valeur } });
      journal.push({ entite: "ComptageResto", entiteId: `${a.articleRestoId}_${jour(x.c.date)}`, champ: `quantite (alignement d'unité${suffixe})`, ancienneValeur: `${x.c.quantite.toString()} ${a.uniteAvant ?? ""}`.trim(), nouvelleValeur: `${x.valeur} ${a.uniteApres}`, userId });
    }
    await tx.articleResto.update({ where: { id: a.articleRestoId }, data: { unite: a.uniteApres, ...(base ? { stockBaseJournalier: base.valeur } : {}) } });
    journal.push({ entite: "ArticleResto", entiteId: a.articleRestoId, champ: `unite (alignement sur l'Inventaire${suffixe})`, ancienneValeur: a.uniteAvant, nouvelleValeur: a.uniteApres, userId });
    if (base && resto.stockBaseJournalier) journal.push({ entite: "ArticleResto", entiteId: a.articleRestoId, champ: `stockBaseJournalier (alignement d'unité${suffixe})`, ancienneValeur: resto.stockBaseJournalier.toString(), nouvelleValeur: base.valeur, userId });
    nbComptages += comptages.length;
  }
  await journaliserPlusieurs(tx, journal);
  return { articles: articles.length, comptages: nbComptages };
}
