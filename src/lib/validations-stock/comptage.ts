import "server-only";

// CŒUR DE LA RÉCONCILIATION (comptage physique → stock au réel) — un seul chemin d'écriture pour le
// comptage appliqué directement par la Direction ET pour la validation d'une réconciliation
// demandée par un autre compte. Hors fichier « use server » pour la même raison que reglement.ts.

import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { envoyerPush } from "@/lib/push";
import { SEUIL_TOLERANCE_PCT, niveauAlerte, type NiveauAlerte } from "@/lib/stock";
import { notifierNouvellesAlertes } from "@/lib/alerte-stock";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { jourKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";

type Tx = Prisma.TransactionClient;

const num = (s: string) => Number(String(s).replace(",", ".").trim());

export type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type CompteSaisi = { articleId: string; physique: number; explication: string };

/** Lit le formulaire de la réconciliation (mêmes règles qu'avant : une case vide n'est pas comptée). */
export function lireComptesSaisis(formData: FormData): { comptes: CompteSaisi[]; domaine: Domaine | null; origine: string } {
  const ids = formData.getAll("recon_articleId").map(String);
  const phys = formData.getAll("recon_physique").map((v) => String(v).trim());
  const expl = formData.getAll("recon_explication").map((v) => String(v).trim());
  const domaineRaw = String(formData.get("domaine") ?? "").trim();
  const domaine = domaineRaw === "NOURRITURE" || domaineRaw === "BOISSON" || domaineRaw === "AUTRE" ? domaineRaw : null;
  const origine = String(formData.get("origine") ?? "").trim() || `Comptage ${jourKinshasa(new Date())}`;
  const comptes = ids
    .map((articleId, i) => ({ articleId, physique: phys[i], explication: expl[i] ?? "" }))
    .filter((c) => c.articleId && c.physique !== "" && Number.isFinite(num(c.physique)))
    .map((c) => ({ articleId: c.articleId, physique: num(c.physique), explication: c.explication }));
  return { comptes, domaine, origine };
}

export type LigneCalculee = {
  articleId: string; designation: string; explication: string;
  theorique: number; physique: number; ecart: number; pct: number; horsTol: boolean;
};

/** Écart et tolérance de chaque ligne (pur) — mêmes formules que la réconciliation d'origine. */
export function calculerLignes(comptes: CompteSaisi[], theo: Map<string, number>, noms: Map<string, string>): LigneCalculee[] {
  return comptes.map((c) => {
    const t = theo.get(c.articleId) ?? 0;
    const ecart = c.physique - t;
    const pct = t !== 0 ? (ecart / Math.abs(t)) * 100 : (ecart !== 0 ? 100 : 0);
    const horsTol = Math.abs(ecart) > 0.0001 && (t === 0 ? c.physique !== 0 : Math.abs(pct) > SEUIL_TOLERANCE_PCT);
    return { ...c, theorique: t, ecart, pct, horsTol, designation: noms.get(c.articleId) ?? "" };
  });
}

export const aUnEcart = (l: { ecart: number }) => Math.abs(l.ecart) > 0.0001;

/** Un écart au-delà de la tolérance exige une explication (refus, rien n'est écrit). */
export function exigerExplications(lignes: LigneCalculee[]) {
  const sansExplication = lignes.filter((l) => l.horsTol && !l.explication);
  if (sansExplication.length > 0) {
    throw new Error(`Écart supérieur à ${SEUIL_TOLERANCE_PCT} % : une explication est requise pour ${sansExplication.map((l) => l.designation).join(", ")}.`);
  }
}

/** Verrouille les lignes de stock des articles (`FOR UPDATE`) : aucune entrée/sortie ne s'intercale. */
export async function verrouillerStocks(tx: Tx, articleIds: string[]) {
  if (articleIds.length === 0) return [];
  // Ordre fixe (par article) : pas d'interblocage entre deux transactions sur les mêmes lignes.
  await tx.$queryRaw`SELECT "id" FROM "stock"."Stock" WHERE "articleId" IN (${Prisma.join(articleIds)}) ORDER BY "articleId" FOR UPDATE`;
  return tx.stock.findMany({ where: { articleId: { in: articleIds } } });
}

/** Ligne à écrire : la ligne comptée + le stock à poser (`stockFinal`, chaîne décimale exacte). */
export type LigneAEcrire = LigneCalculee & { stockFinal: string };

/**
 * Écrit un comptage : fiche archivée (SessionComptage + lignes), un mouvement d'AJUSTEMENT par
 * écart, et le stock posé à `stockFinal`. Écritures GROUPÉES (createMany + un seul UPDATE…FROM
 * VALUES) : 3 requêtes par ligne dépassaient le délai d'une transaction en production (P2028).
 */
export async function ecrireComptageTx(tx: Tx, userId: string, p: { domaine: Domaine | null; origine: string; lignes: LigneAEcrire[]; date?: Date }) {
  const { lignes, origine, domaine } = p;
  const nbEcarts = lignes.filter(aUnEcart).length;
  const nbHorsTol = lignes.filter((l) => l.horsTol).length;
  // `date` : jour du COMPTAGE (réconciliation validée plus tard) ; absent = aujourd'hui, comme avant.
  const s = await tx.sessionComptage.create({ data: { domaine, nbArticles: lignes.length, nbEcarts, nbHorsTol, creeParId: userId, date: p.date ?? jourCivilKinshasa(new Date()) } }); // explicite : le défaut @default(now()) de la base est le jour UTC
  await tx.ligneComptage.createMany({
    data: lignes.map((l) => ({
      sessionId: s.id, articleId: l.articleId, designation: l.designation,
      theorique: l.theorique, physique: l.physique, ecart: l.ecart,
      ecartPct: Number.isFinite(l.pct) ? Math.round(l.pct * 100) / 100 : null,
      explication: l.explication || null,
    })),
  });
  const avecEcart = lignes.filter(aUnEcart);
  if (avecEcart.length > 0) {
    await tx.mouvementStock.createMany({
      data: avecEcart.map((l) => ({ articleId: l.articleId, type: "AJUSTEMENT" as const, quantite: Math.abs(l.ecart), origine, date: jourCivilKinshasa(new Date()), creeParId: userId })),
    });
  }
  const existants = new Set((await tx.stock.findMany({ where: { articleId: { in: lignes.map((l) => l.articleId) } }, select: { articleId: true } })).map((x) => x.articleId));
  const maj = lignes.filter((l) => existants.has(l.articleId));
  if (maj.length > 0) {
    await tx.$executeRaw`
      UPDATE "stock"."Stock" AS s SET "quantite" = v.q, "updatedAt" = now()
      FROM (VALUES ${Prisma.join(maj.map((l) => Prisma.sql`(${l.articleId}, ${l.stockFinal}::decimal)`))}) AS v("articleId", q)
      WHERE s."articleId" = v."articleId"`;
  }
  const manquants = lignes.filter((l) => !existants.has(l.articleId));
  if (manquants.length > 0) {
    await tx.stock.createMany({ data: manquants.map((l) => ({ articleId: l.articleId, quantite: l.stockFinal })) });
  }
  return { session: s, nbEcarts, nbHorsTol };
}

/** Niveaux d'alerte des stocks donnés (à lire AVANT l'écriture, pour notifier ceux qui passent bas). */
export function niveauxDe(stocks: { articleId: string; quantite: Prisma.Decimal; stockMinimum: Prisma.Decimal }[]): Map<string, NiveauAlerte> {
  return new Map(stocks.map((s) => [s.articleId, niveauAlerte(s.quantite, s.stockMinimum)]));
}

/** Après l'écriture (hors transaction) : écarts hors tolérance et articles passés sous le seuil. */
export async function apresComptage(p: { sessionId: string; nbHorsTol: number; articleIds: string[]; niveauxAvant: Map<string, NiveauAlerte> }) {
  if (p.nbHorsTol > 0) {
    const cibles = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "STOCK"] }, actif: true }, select: { id: true } });
    await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Comptage du ${jourKinshasa(new Date())} : ${p.nbHorsTol} écart(s) supérieur(s) à ${SEUIL_TOLERANCE_PCT} %.`, lien: `/stock/archives/${p.sessionId}`, refId: p.sessionId } });
    await envoyerPush(cibles.map((c) => c.id), { title: "Écart d'inventaire", body: `${p.nbHorsTol} écart(s) > ${SEUIL_TOLERANCE_PCT} % lors du comptage.`, url: `/stock/archives/${p.sessionId}`, tag: `comptage-${p.sessionId}` });
  }
  await notifierNouvellesAlertes(p.articleIds, p.niveauxAvant);
}

// ── Validation d'une réconciliation demandée ────────────────────────────────
/**
 * Stock à poser quand la Direction valide un comptage fait PLUS TÔT.
 *
 * Le comptage a constaté, à l'instant du comptage, un écart E = physique − théorique. Entre ce
 * comptage et la validation, le restaurant a continué de vivre : entrées, sorties… Poser le stock à
 * la quantité comptée effacerait ces mouvements (un sac sorti hier réapparaîtrait). On applique donc
 * l'ÉCART constaté au stock ACTUEL : stock final = stock actuel + E. Si rien n'a bougé, c'est
 * exactement la quantité comptée — l'écriture du geste direct.
 *
 * Ce n'est sûr QUE si tout ce qui a bougé depuis s'explique par des entrées et des sorties
 * enregistrées après le comptage. Si le stock a changé autrement (un autre comptage ou ajustement,
 * une quantité corrigée à la main, une fusion, un mouvement supprimé), appliquer E compterait deux
 * fois la même correction : la validation est refusée en nommant l'article — il faut recompter.
 */
export type EtatValidationLigne =
  | { etat: "inchange"; actuel: Decimal; final: Decimal }
  | { etat: "mouvemente"; actuel: Decimal; final: Decimal; entrees: Decimal; sorties: Decimal }
  | { etat: "conflit"; actuel: Decimal; raison: string };

export type MouvementsDepuis = { entrees: Decimal; sorties: Decimal; ajustements: number; tardifs: number };

export function etatLigneAValider(l: { theorique: string; physique: string }, actuel: Decimal, depuis: MouvementsDepuis): EtatValidationLigne {
  const t = new Decimal(l.theorique);
  const ecart = new Decimal(l.physique).minus(t);
  if (depuis.ajustements > 0) return { etat: "conflit", actuel, raison: "un autre comptage ou ajustement a été enregistré depuis" };
  // Saisie TARDIVE : une entrée/sortie enregistrée après le comptage mais datée du JOUR du comptage
  // ou d'avant (la consommation de vendredi saisie samedi ; la sortie du matin saisie le soir d'un
  // comptage fait à midi). Le comptage l'a peut-être déjà constatée dans son écart : l'appliquer en
  // plus compterait deux fois la même consommation. Seuls les mouvements datés STRICTEMENT après le
  // jour du comptage sont « expliqués ».
  if (depuis.tardifs > 0) return { etat: "conflit", actuel, raison: "une entrée ou sortie datée du jour du comptage ou d'avant a été saisie depuis (déjà comptée ou non : impossible de trancher)" };
  const explique = depuis.entrees.minus(depuis.sorties);
  if (!actuel.minus(t).equals(explique)) return { etat: "conflit", actuel, raison: `le stock a changé sans mouvement qui l'explique (compté sur ${t.toString().replace(".", ",")}, aujourd'hui ${actuel.toString().replace(".", ",")})` };
  if (actuel.equals(t)) return { etat: "inchange", actuel, final: new Decimal(l.physique) };
  return { etat: "mouvemente", actuel, final: actuel.plus(ecart), entrees: depuis.entrees, sorties: depuis.sorties };
}

/** Mouvements enregistrés APRÈS l'instant `depuis` sur ces articles, agrégés par article. */
export async function mouvementsDepuis(client: Tx | typeof prisma, articleIds: string[], depuis: Date) {
  const r = new Map<string, MouvementsDepuis>();
  for (const id of articleIds) r.set(id, { entrees: new Decimal(0), sorties: new Decimal(0), ajustements: 0, tardifs: 0 });
  if (articleIds.length === 0) return r;
  // Jour civil du comptage à Kinshasa (UTC+1) : un mouvement daté de ce jour-là ou d'avant, mais saisi
  // après la demande, est TARDIF (date de mouvement inclusive : le même jour ne prouve pas l'« après »).
  const jourComptage = new Date(`${jourKinshasaISO(depuis)}T00:00:00.000Z`);
  const tardifs = await client.mouvementStock.groupBy({
    by: ["articleId"],
    where: { articleId: { in: articleIds }, createdAt: { gt: depuis }, date: { lte: jourComptage } },
    _count: { _all: true },
  });
  for (const g of tardifs) r.get(g.articleId)!.tardifs = g._count._all;
  const lignes = await client.mouvementStock.groupBy({
    by: ["articleId", "type"],
    where: { articleId: { in: articleIds }, createdAt: { gt: depuis } },
    _sum: { quantite: true },
    _count: { _all: true },
  });
  for (const g of lignes) {
    const e = r.get(g.articleId)!;
    const q = new Decimal(g._sum.quantite?.toString() ?? "0");
    if (g.type === "ENTREE") e.entrees = e.entrees.plus(q);
    else if (g.type === "SORTIE") e.sorties = e.sorties.plus(q);
    else e.ajustements += g._count._all;
  }
  return r;
}
