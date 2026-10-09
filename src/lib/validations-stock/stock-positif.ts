import "server-only";

// PORTE UNIQUE DES QUANTITÉS EN STOCK — « un stock ne passe jamais sous 0 » (Sacha, 2026-10-09) :
// « les articles ne peuvent pas tomber sous le seuil de 0. refus de sortir un article en une quantité
// qui le ferait passer en-dessous de 0. si le stock est de 5, on peut en sortir 5, pas 6. »
//
// Toute écriture de `Stock.quantite` passe par ce fichier, et par lui seul (garde-fou
// `chemins-ecriture.garde-fou.test.ts`, bloc « stock jamais négatif ») :
//  - `variationsStockTx` : ajoute ou retire des quantités (sorties manuelles, entrées, imports,
//    suppressions de mouvements ou de factures, fusion d'articles). Une variation NÉGATIVE qui
//    laisserait l'article sous 0 est REFUSÉE — tout ou rien : rien n'est écrit, et chaque article
//    fautif est nommé avec son stock disponible (« Riz : 5 kg disponibles, 6 kg demandés »).
//    Un article déjà négatif en base ne peut donc plus rien perdre ; il peut toujours recevoir.
//  - `poserStocksTx` : pose une quantité ABSOLUE (comptage, import d'inventaire, quantité saisie sur la
//    fiche, remise à 0 d'un négatif, annulation d'import). Une quantité posée négative est refusée.
//
// Le contrôle se fait SOUS VERROU : lignes Stock verrouillées (`FOR UPDATE`) dans l'ordre des ids
// d'article — le même que `verrouillerStocks` (comptage, validations), donc sans interblocage — puis
// relues : deux sorties simultanées de 3 sur un stock de 5 s'attendent, la seconde relit 2 et est
// refusée. Calcul en décimal exact (Decimal(14,3)) : 0,1 + 0,2 sorties d'un stock de 0,3 passent.
//
// Les quantités sont celles de l'UNITÉ DE L'ARTICLE (aucun chemin de sortie n'en porte une autre :
// la contenance d'une bouteille ne sert qu'au coût et à la disponibilité des fiches).
//
// Pas de contrainte CHECK en base : des stocks négatifs existent peut-être en production (la Direction
// a « Corriger les stocks négatifs ») et on ne peut pas le vérifier d'ici ; la garde est applicative.

import { Prisma } from "@prisma/client";
import { verrouillerStocks } from "./comptage";
import { formaterNombre } from "@/lib/montant";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";

type Tx = Prisma.TransactionClient;
type Quantite = Prisma.Decimal | number | string;

/** Un article qu'une écriture ferait passer sous 0 (quantités en texte décimal exact). */
export type Manque = {
  articleId: string; designation: string; unite: string | null; disponible: string; demande: string;
  /** Nom AFFICHÉ dans le refus (`libelleArticle` : contenance comprise) ; la désignation brute sert aux articles proches. */
  libelle?: string;
};

/** Refus « stock insuffisant » : porte les articles fautifs (l'écran Mouvements propose des articles proches). */
export class StockInsuffisant extends Error {
  readonly manques: Manque[];
  constructor(manques: Manque[], verbe: string) {
    super(messageManques(manques, verbe));
    this.name = "StockInsuffisant";
    this.manques = manques;
  }
}

const nombre = (s: string) => formaterNombre(Number(s), { maximumFractionDigits: 3 });
const avecUnite = (s: string, unite: string | null) => (unite?.trim() ? `${nombre(s)} ${unite.trim()}` : nombre(s));
const accorde = (mot: string, n: string) => (Math.abs(Number(n)) >= 2 && /é$/.test(mot) ? `${mot}s` : mot);

/** « Riz : 5 kg disponibles, 6 kg demandés » ; un stock déjà négatif est dit tel quel. */
export function ligneManque(m: Manque, verbe = "demandé"): string {
  const demande = `${avecUnite(m.demande, m.unite)} ${accorde(verbe, m.demande)}`;
  if (Number(m.disponible) < 0) return `${m.libelle ?? m.designation} : stock déjà négatif (${avecUnite(m.disponible, m.unite)}), ${demande} — faites d'abord corriger son stock (comptage)`;
  return `${m.libelle ?? m.designation} : ${avecUnite(m.disponible, m.unite)} disponible${Math.abs(Number(m.disponible)) >= 2 ? "s" : ""}, ${demande}`;
}

export function messageManques(manques: Manque[], verbe = "demandé"): string {
  return `Stock insuffisant — un stock ne passe jamais sous 0 : ${manques.map((m) => ligneManque(m, verbe)).join(" ; ")}. Rien n'a été enregistré.`;
}

/**
 * Ajoute (delta > 0) ou retire (delta < 0) des quantités, sous verrou, tout ou rien. Les variations
 * d'un même article s'additionnent (deux lignes de 3 sur un stock de 5 : refusées). `verbe` nomme la
 * quantité retirée dans le refus (« demandé », « à reprendre »…).
 */
export async function variationsStockTx(tx: Tx, variations: { articleId: string; delta: Quantite }[], { verbe = "demandé" }: { verbe?: string } = {}) {
  const total = new Map<string, Prisma.Decimal>();
  for (const v of variations) {
    const d = new Prisma.Decimal(v.delta);
    if (!d.isFinite()) throw new Error("Quantité illisible : rien n'a été enregistré.");
    total.set(v.articleId, (total.get(v.articleId) ?? new Prisma.Decimal(0)).plus(d));
  }
  const ids = [...total.keys()].sort();
  if (ids.length === 0) return;
  const stocks = await verrouillerStocks(tx, ids);
  const actuel = new Map(stocks.map((s) => [s.articleId, s.quantite]));
  const baisses = ids.filter((id) => total.get(id)!.isNegative() && !total.get(id)!.isZero());
  if (baisses.length > 0) {
    const fautifs = baisses.filter((id) => (actuel.get(id) ?? new Prisma.Decimal(0)).plus(total.get(id)!).isNegative());
    if (fautifs.length > 0) {
      const arts = new Map((await tx.articleStock.findMany({ where: { id: { in: fautifs } }, select: { id: true, ...CHAMPS_LIBELLE, unite: true } })).map((a) => [a.id, a]));
      throw new StockInsuffisant(fautifs.map((id) => ({
        articleId: id,
        designation: arts.get(id)?.designation ?? "Article inconnu",
        ...(arts.get(id) ? { libelle: libelleArticle(arts.get(id)!) } : {}),
        unite: arts.get(id)?.unite ?? null,
        disponible: (actuel.get(id) ?? new Prisma.Decimal(0)).toString(),
        demande: total.get(id)!.negated().toString(),
      })), verbe);
    }
  }
  for (const id of ids) {
    const d = total.get(id)!;
    if (d.isZero()) continue;
    if (d.isNegative()) await tx.stock.update({ where: { articleId: id }, data: { quantite: { decrement: d.negated() } } }); // ligne présente : refus plus haut sinon
    else await tx.stock.upsert({ where: { articleId: id }, update: { quantite: { increment: d } }, create: { articleId: id, quantite: d } });
  }
}

/** Retire des quantités (toutes > 0) : refus nommé si un article passerait sous 0. */
export async function sortirDuStockTx(tx: Tx, lignes: { articleId: string; quantite: Quantite }[], opts?: { verbe?: string }) {
  for (const l of lignes) if (!new Prisma.Decimal(l.quantite).greaterThan(0)) throw new Error("Une sortie porte une quantité positive : rien n'a été enregistré.");
  await variationsStockTx(tx, lignes.map((l) => ({ articleId: l.articleId, delta: new Prisma.Decimal(l.quantite).negated() })), opts);
}

/** Ajoute des quantités (toutes > 0) : crée la ligne Stock si absente. */
export async function entrerEnStockTx(tx: Tx, lignes: { articleId: string; quantite: Quantite }[]) {
  for (const l of lignes) if (!new Prisma.Decimal(l.quantite).greaterThan(0)) throw new Error("Une entrée porte une quantité positive : rien n'a été enregistré.");
  await variationsStockTx(tx, lignes.map((l) => ({ articleId: l.articleId, delta: l.quantite })));
}

/**
 * Pose des quantités ABSOLUES (comptage, inventaire importé, saisie de la fiche, remise à 0,
 * annulation d'import). Une quantité négative est refusée en nommant les articles ; la ligne Stock
 * absente est créée. Écriture GROUPÉE (un UPDATE … FROM VALUES + un createMany) : 3 requêtes par ligne
 * dépassaient le délai d'une transaction en production (P2028, comptage de tout le catalogue).
 */
export async function poserStocksTx(tx: Tx, lignes: { articleId: string; quantite: Quantite }[], { quoi = "quantité posée" }: { quoi?: string } = {}) {
  if (lignes.length === 0) return;
  const parId = new Map<string, Prisma.Decimal>();
  for (const l of lignes) {
    const q = new Prisma.Decimal(l.quantite);
    if (!q.isFinite()) throw new Error("Quantité illisible : rien n'a été enregistré.");
    parId.set(l.articleId, q);
  }
  const ids = [...parId.keys()].sort();
  const actuels = new Map((await verrouillerStocks(tx, ids)).map((s) => [s.articleId, s.quantite]));
  const existants = new Set(actuels.keys());
  // Refus d'une quantité NÉGATIVE posée — sauf si c'est la valeur déjà en base (une ligne de comptage
  // en conflit garde son stock actuel : un négatif existant n'est ni inventé ni réécrit autrement).
  const negatifs = ids.filter((id) => parId.get(id)!.isNegative() && !parId.get(id)!.isZero() && !actuels.get(id)?.equals(parId.get(id)!));
  if (negatifs.length > 0) {
    const arts = new Map((await tx.articleStock.findMany({ where: { id: { in: negatifs } }, select: { id: true, ...CHAMPS_LIBELLE, unite: true } })).map((a) => [a.id, a]));
    // Noms dans l'ordre alphabétique : un message stable (les ids, eux, sont tirés au hasard).
    const noms = negatifs.map((id) => `${arts.has(id) ? libelleArticle(arts.get(id)!) : "Article inconnu"} (${avecUnite(parId.get(id)!.toString(), arts.get(id)?.unite ?? null)})`).sort((a, b) => a.localeCompare(b, "fr"));
    throw new Error(`Quantité négative refusée (${quoi}) — un stock ne passe jamais sous 0 : ${noms.join(", ")}. Rien n'a été enregistré.`);
  }
  const maj = ids.filter((id) => existants.has(id));
  if (maj.length > 0) {
    await tx.$executeRaw`
      UPDATE "stock"."Stock" AS s SET "quantite" = v.q, "updatedAt" = now()
      FROM (VALUES ${Prisma.join(maj.map((id) => Prisma.sql`(${id}, ${parId.get(id)!.toString()}::decimal)`))}) AS v("articleId", q)
      WHERE s."articleId" = v."articleId"`;
  }
  const manquants = ids.filter((id) => !existants.has(id));
  if (manquants.length > 0) await tx.stock.createMany({ data: manquants.map((id) => ({ articleId: id, quantite: parId.get(id)! })) });
}
