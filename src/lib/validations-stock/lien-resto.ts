import "server-only";

// CŒUR DU RATTACHEMENT « article du restaurant ↔ articles du catalogue » (table de liaison
// `ArticleRestoStock`) — UN SEUL chemin d'écriture pour le geste direct de la Direction ET pour la
// validation d'une demande (comme `article.ts` pour les modifications d'article). Hors fichier
// « use server » pour la même raison : ces fonctions ne sont pas des points d'entrée.
//
// Règle de Sacha (2026-10-12) : rattacher ET détacher une marque est un geste que la Direction fait
// directement ; tout autre compte du Stock dépose une DEMANDE à valider (demandes.ts, nature LIEN_RESTO).
// Un détachement n'efface aucune donnée métier (ni article, ni comptage, ni mouvement) : c'est un lien.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliserPlusieurs } from "@/lib/audit";
import type { OperationLien } from "./charge";
import Decimal from "decimal.js";
import { facteurVersArticle, normaliserUnite, uniteManquante, type UniteArticle } from "@/lib/fiches/conversion";

type Tx = Prisma.TransactionClient;

/** Champ du journal d'audit d'un lien posé ou retiré (libellé de l'article du catalogue, avant → après). */
export const CHAMP_LIEN = "lien article du catalogue";

/** Unités de l'article du restaurant et de l'article de l'Inventaire : MANQUANTE si l'une est vide, DIFFERENTE si elles ne sont pas la même (normalisée), null si identiques. */
export function ecartUnite(uniteResto: string | null | undefined, uniteInventaire: string | null | undefined): "MANQUANTE" | "DIFFERENTE" | null {
  if (uniteManquante(uniteResto) || uniteManquante(uniteInventaire)) return "MANQUANTE";
  return normaliserUnite(uniteResto!) === normaliserUnite(uniteInventaire!) ? null : "DIFFERENTE";
}

/**
 * Taille d'UNE unité de l'article, en grammes ET en millilitres (null : inconnue). Deux marques de même
 * unité mais de tailles différentes (« Pièce » de 250 g et « Pièce » de 500 g) ne s'additionnent pas au
 * restaurant : la quantité y serait comptée en unités, pas en grammes.
 */
function tailleUnite(a: UniteArticle): string {
  const dans = (u: string) => { const f = facteurVersArticle(u, a); return f === null || f.num.isZero() ? "?" : new Decimal(f.den).div(f.num).toDecimalPlaces(9).toString(); };
  return `${dans("g")}|${dans("ml")}`;
}

const NOM_ESPACE = { CUISINE: "Cuisine", BAR: "Bar" } as const;

/**
 * Ce qui empêche d'exécuter ces opérations MAINTENANT (liste vide : rien). Les mêmes constats servent au
 * geste direct, à l'aperçu de la Direction (alertes) et à la validation (demande périmée) :
 *  - l'article du restaurant ou celui du catalogue n'existe plus ; un article du catalogue désactivé ne s'ajoute pas ;
 *  - AJOUT d'un lien déjà posé, RETRAIT d'un lien déjà retiré (la demande est périmée) ;
 *  - AJOUT d'un article du catalogue déjà rattaché à un AUTRE article du restaurant du MÊME espace (ses
 *    livraisons iraient aux deux) — Cuisine et Bar peuvent chacun avoir le leur.
 */
export async function obstaclesLiens(tx: Tx | typeof prisma, ops: OperationLien[]): Promise<string[]> {
  const restoIds = [...new Set(ops.map((o) => o.articleRestoId))];
  const stockIds = [...new Set(ops.map((o) => o.articleStockId))];
  const [restos, stocks, liens] = await Promise.all([
    tx.articleResto.findMany({ where: { id: { in: restoIds } }, select: { id: true, espace: true, unite: true } }),
    tx.articleStock.findMany({ where: { id: { in: stockIds } }, select: { id: true, actif: true, unite: true, contenance: true, contenanceUnite: true } }),
    tx.articleRestoStock.findMany({ where: { articleStockId: { in: stockIds } }, select: { articleRestoId: true, articleStockId: true, articleResto: { select: { designation: true, espace: true } } } }),
  ]);
  const marquesLiees = ops.some((o) => o.op === "AJOUT")
    ? await tx.articleRestoStock.findMany({ where: { articleRestoId: { in: restoIds } }, select: { articleRestoId: true, articleStock: { select: { id: true, designation: true, unite: true, contenance: true, contenanceUnite: true } } } })
    : [];
  const retirees = new Set(ops.filter((o) => o.op === "RETRAIT").map((o) => `${o.articleRestoId}|${o.articleStockId}`));
  const reference = new Map<string, { nom: string; taille: string }>(); // marque déjà rattachée (ou ajoutée dans ce lot) par article du restaurant
  for (const m of marquesLiees) {
    if (retirees.has(`${m.articleRestoId}|${m.articleStock.id}`) || reference.has(m.articleRestoId)) continue;
    reference.set(m.articleRestoId, { nom: m.articleStock.designation, taille: tailleUnite({ unite: m.articleStock.unite, contenance: m.articleStock.contenance?.toString() ?? null, contenanceUnite: m.articleStock.contenanceUnite }) });
  }
  const resto = new Map(restos.map((r) => [r.id, r]));
  const stock = new Map(stocks.map((s) => [s.id, s]));
  const obstacles: string[] = [];
  for (const o of ops) {
    const nom = `« ${o.articleStockDesignation} » ↔ « ${o.articleRestoDesignation} »`;
    const r = resto.get(o.articleRestoId);
    if (!r) { obstacles.push(`${nom} : l'article du restaurant n'existe plus`); continue; }
    const s = stock.get(o.articleStockId);
    const pose = liens.some((l) => l.articleRestoId === o.articleRestoId && l.articleStockId === o.articleStockId);
    if (o.op === "RETRAIT") {
      if (!pose) obstacles.push(`${nom} : ce lien n'existe plus (déjà retiré)`);
      continue;
    }
    if (!s) { obstacles.push(`${nom} : l'article du catalogue n'existe plus`); continue; }
    if (!s.actif) { obstacles.push(`${nom} : l'article du catalogue est désactivé`); continue; }
    if (pose) { obstacles.push(`${nom} : déjà rattaché`); continue; }
    // UNE seule unité par produit, celle de l'Inventaire : on ne rattache qu'une marque de la MÊME unité.
    const ecart = ecartUnite(r.unite, s.unite);
    if (ecart) {
      obstacles.push(ecart === "MANQUANTE"
        ? `« ${o.articleRestoDesignation} » ou « ${o.articleStockDesignation} » n'a pas d'unité : renseignez-la d'abord (l'Inventaire donne l'unité)`
        : `« ${o.articleStockDesignation} » est en ${s.unite!.trim()} dans l'Inventaire, « ${o.articleRestoDesignation} » est en ${r.unite!.trim()} : alignez l'unité dans l'Inventaire d'abord (ou « Aligner sur l'Inventaire » au Stock restaurant)`);
      continue;
    }
    // Même unité, mais pas la même TAILLE d'unité (Pièce de 250 g / de 500 g) : leurs quantités ne s'additionnent pas.
    const taille = tailleUnite({ unite: s.unite, contenance: s.contenance?.toString() ?? null, contenanceUnite: s.contenanceUnite });
    const ref = reference.get(o.articleRestoId);
    if (ref && ref.taille !== taille) {
      obstacles.push(`« ${o.articleStockDesignation} » n'a pas la même contenance par ${s.unite!.trim()} que « ${ref.nom} », déjà rattaché à « ${o.articleRestoDesignation} » : leurs quantités ne s'additionneraient pas (renseignez ou corrigez la contenance dans l'Inventaire, ou créez un autre article du restaurant)`);
      continue;
    }
    if (!ref) reference.set(o.articleRestoId, { nom: o.articleStockDesignation, taille });
    const ailleurs = liens.find((l) => l.articleStockId === o.articleStockId && l.articleRestoId !== o.articleRestoId && l.articleResto.espace === r.espace);
    if (ailleurs) obstacles.push(`« ${o.articleStockDesignation} » est déjà rattaché à « ${ailleurs.articleResto.designation} » (${NOM_ESPACE[r.espace]}) : détachez-le d'abord de cet article du restaurant, ses livraisons iraient sinon aux deux`);
  }
  return obstacles;
}

const journalLiens = (tx: Tx, userId: string, ops: OperationLien[], suffixe: string) =>
  journaliserPlusieurs(tx, ops.map((o) => ({
    entite: "ArticleResto", entiteId: o.articleRestoId, champ: `${CHAMP_LIEN}${suffixe}`,
    ancienneValeur: o.op === "RETRAIT" ? o.articleStockDesignation : null, nouvelleValeur: o.op === "AJOUT" ? o.articleStockDesignation : null, userId,
  })));

/** Pose des liens (déjà contrôlés par `obstaclesLiens`) et les journalise (« → libellé »). `suffixe` : « (proposition validée) ». */
export async function poserLiensTx(tx: Tx, userId: string, ops: OperationLien[], suffixe = ""): Promise<number> {
  const ajouts = ops.filter((o) => o.op === "AJOUT");
  if (ajouts.length === 0) return 0;
  await tx.articleRestoStock.createMany({ data: ajouts.map((o) => ({ articleRestoId: o.articleRestoId, articleStockId: o.articleStockId })), skipDuplicates: true });
  await journalLiens(tx, userId, ajouts, suffixe);
  return ajouts.length;
}

/**
 * Retire des liens et les journalise (« libellé → »). Un retrait en direct est réservé à la Direction :
 * l'appelant le garde (`exigerDirectionPourSupprimer`) ; une demande validée passe par `ecrireLiensTx`.
 */
export async function retirerLiensTx(tx: Tx, userId: string, ops: OperationLien[], suffixe = ""): Promise<number> {
  const retraits = ops.filter((o) => o.op === "RETRAIT");
  if (retraits.length === 0) return 0;
  for (const o of retraits) await tx.articleRestoStock.deleteMany({ where: { articleRestoId: o.articleRestoId, articleStockId: o.articleStockId } });
  await journalLiens(tx, userId, retraits, suffixe);
  return retraits.length;
}

/** Pose et retire les opérations d'une demande VALIDÉE par la Direction (même cœur que les gestes directs). */
export async function ecrireLiensTx(tx: Tx, userId: string, ops: OperationLien[], suffixe = ""): Promise<{ ajoutes: number; retires: number }> {
  return { ajoutes: await poserLiensTx(tx, userId, ops, suffixe), retires: await retirerLiensTx(tx, userId, ops, suffixe) };
}

/** « Rattacher « Lurpak » à « Beurre » (Cuisine) » — résumé lisible d'une demande. */
export function resumeLiens(ops: OperationLien[]): string {
  const un = (o: OperationLien) => (o.op === "AJOUT"
    ? `Rattacher « ${o.articleStockDesignation} » à « ${o.articleRestoDesignation} » (${NOM_ESPACE[o.espace]})`
    : `Détacher « ${o.articleStockDesignation} » de « ${o.articleRestoDesignation} » (${NOM_ESPACE[o.espace]})`);
  if (ops.length === 1) return un(ops[0]!);
  const restos = new Set(ops.map((o) => o.articleRestoId));
  const ajouts = ops.filter((o) => o.op === "AJOUT").length, retraits = ops.length - ajouts;
  if (restos.size === 1) {
    const r = ops[0]!;
    const parties = [ajouts ? `rattacher ${ajouts} article${ajouts > 1 ? "s" : ""}` : null, retraits ? `détacher ${retraits}` : null].filter(Boolean).join(", ");
    return `${parties.charAt(0).toUpperCase()}${parties.slice(1)} — « ${r.articleRestoDesignation} » (${NOM_ESPACE[r.espace]}) : ${ops.map((o) => `« ${o.articleStockDesignation} »`).join(", ")}`;
  }
  return `${ops.length} rattachements au restaurant (${ajouts} ajout${ajouts > 1 ? "s" : ""}, ${retraits} retrait${retraits > 1 ? "s" : ""})`;
}
