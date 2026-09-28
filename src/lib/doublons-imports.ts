import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { apparierUnAUn, controleApresRetrait, datePure, type EcartControle, type MouvementComparable } from "./jumeaux-mouvements";
import { exigerPeriodesOuvertes } from "./cloture-stock";
import { journaliser } from "./audit";
import { dateHeureKinshasa, jourKinshasa } from "./heure-kinshasa";

// ─────────────────────────────────────────────────────────────────────────────
// DOUBLONS D'IMPORTS DE STOCK.
//
// Le 2026-09-28, l'import d'inventaire (qui pose le stock final en ABSOLU) a aussi recréé tout le
// journal détaillé du classeur, déjà importé le matin même par l'import de mouvements : 602
// mouvements en double. Le stock était juste (posé en absolu) ; seul l'historique était doublé
// (liste des mouvements, consommation du mois, sorties de la conso journalière).
//
// Deux outils ici :
//   1. le GARDE-FOU (`repererDejaPresents`) : un import n'insère plus un mouvement qui a déjà un
//      jumeau exact en base (cf. `jumeaux-mouvements.ts`) ;
//   2. le NETTOYAGE (`detecterDoublons` / `retirerDoublons`) : retire les copies de l'import
//      d'INVENTAIRE, garde celles de l'import de MOUVEMENTS, sans toucher au stock.
//
// Dans les deux cas, l'opération d'import concernée garde une trace qui NOMME le jumeau
// conservé (`avant.jumeauId`) : « Annuler l'import » ne la rejoue pas (elle n'est ni CREATE ni
// UPDATE), et refuse d'annuler l'import qui porte ce jumeau tant que l'autre s'appuie dessus.
// ─────────────────────────────────────────────────────────────────────────────

type Client = Prisma.TransactionClient | typeof prisma;

/** Copie retirée par l'outil de nettoyage (l'opération CREATE d'origine est requalifiée). */
export const ACTION_DOUBLON_RETIRE = "DOUBLON_RETIRE";
/** Mouvement du fichier ignoré à l'import : il avait déjà un jumeau en base. */
export const ACTION_DEJA_PRESENT = "DEJA_PRESENT";

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Trace rangée dans `ImportOperation.avant` : le mouvement tel qu'il était, et son jumeau. */
export function traceJumeau(jumeauId: string, m: MouvementComparable): Prisma.InputJsonObject {
  return { jumeauId, articleId: m.articleId, date: datePure(m.date), type: m.type, quantite: String(m.quantite) };
}

// ── 1. Garde-fou ─────────────────────────────────────────────────────────────

/**
 * Sépare les mouvements à insérer de ceux qui ont DÉJÀ un jumeau exact en base (quelle que soit
 * son origine). Appariement un à un : trois sorties identiques dans le fichier et une en base →
 * deux insérées. Lire dans la transaction d'écriture (`client` = tx).
 */
export async function repererDejaPresents<T extends MouvementComparable>(
  client: Client,
  candidats: T[]
): Promise<{ nouveaux: T[]; dejaPresents: { candidat: T; jumeauId: string }[] }> {
  if (candidats.length === 0) return { nouveaux: [], dejaPresents: [] };
  const dates = candidats.map((c) => datePure(c.date)).sort();
  const existants = await client.mouvementStock.findMany({
    where: {
      articleId: { in: [...new Set(candidats.map((c) => c.articleId))] },
      date: { gte: jour(dates[0]), lte: jour(dates[dates.length - 1]) },
    },
    select: { id: true, articleId: true, date: true, type: true, quantite: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const r = apparierUnAUn(existants, candidats);
  return { nouveaux: r.candidatsSeuls, dejaPresents: r.paires.map((p) => ({ candidat: p.candidat, jumeauId: p.reference.id })) };
}

/**
 * Refus d'annuler un import dont des mouvements portent l'historique d'un AUTRE import encore
 * appliqué (copie retirée par le nettoyage, ou mouvement ignoré car déjà présent). L'annuler
 * effacerait ces mouvements du journal des deux imports. Renvoie le message, ou null.
 */
export async function refusAnnulationHistoriquePorte(client: Client, batchId: string, idsMouvements: string[]): Promise<string | null> {
  if (idsMouvements.length === 0) return null;
  const porteurs = await client.$queryRaw<{ libelle: string; n: bigint }[]>`
    SELECT b.libelle, COUNT(DISTINCT o.avant->>'jumeauId') AS n
    FROM "stock"."ImportOperation" o
    JOIN "stock"."ImportBatch" b ON b.id = o."batchId"
    WHERE o.action IN ('DOUBLON_RETIRE', 'DEJA_PRESENT')
      AND b.statut = 'APPLIQUE'
      AND o."batchId" <> ${batchId}
      AND o.avant->>'jumeauId' = ANY(${idsMouvements}::text[])
    GROUP BY b.id, b.libelle, b."createdAt"
    ORDER BY b."createdAt"`;
  if (porteurs.length === 0) return null;
  const n = porteurs.reduce((t, p) => t + Number(p.n), 0);
  const noms = porteurs.map((p) => `« ${p.libelle} »`).join(", ");
  return (
    `Annulation impossible : ${n} mouvement(s) de cet import portent aussi l'historique de ${noms} ` +
    `(doublons retirés ou ignorés car déjà présents). L'annuler effacerait ces mouvements du journal. ` +
    `Annulez d'abord ${noms}, puis relancez. Rien n'a été annulé.`
  );
}

// ── 2. Nettoyage ─────────────────────────────────────────────────────────────

export type LotImport = { id: string; libelle: string; type: string; creeLe: string; jour: string };
export type MvtDoublon = { id: string; articleId: string; article: string; date: string; type: string; quantite: number; batchId: string; libelle: string };
export type ApercuDoublons = {
  inventaire: LotImport;
  mouvements: LotImport[];
  /** `retire` : copie de l'import d'inventaire (supprimée) ; `garde` : copie de l'import de mouvements. */
  paires: { retire: MvtDoublon; garde: MvtDoublon }[];
  sansJumeauInventaire: MvtDoublon[];
  sansJumeauMouvements: MvtDoublon[];
  controle: { verifies: number; ecarts: (EcartControle & { article: string })[] };
};

const lot = (b: { id: string; libelle: string; type: string; createdAt: Date }): LotImport => ({
  id: b.id, libelle: b.libelle, type: b.type, creeLe: dateHeureKinshasa(b.createdAt), jour: jourKinshasa(b.createdAt),
});

/** Imports proposés à l'outil ; par défaut, le dernier inventaire et les imports de mouvements du même jour. */
export async function lotsPourDoublons(): Promise<{ inventaires: LotImport[]; mouvements: LotImport[]; defaut: { inventaireId: string | null; mouvementsIds: string[] } }> {
  const batches = await prisma.importBatch.findMany({
    where: { statut: "APPLIQUE", type: { in: ["INVENTAIRE", "MOUVEMENTS"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, libelle: true, type: true, createdAt: true },
  });
  const inventaires = batches.filter((b) => b.type === "INVENTAIRE").map(lot);
  const mouvements = batches.filter((b) => b.type === "MOUVEMENTS").map(lot);
  const inv = inventaires[0] ?? null;
  const mouvementsIds = inv ? mouvements.filter((m) => m.jour === inv.jour).map((m) => m.id).reverse() : [];
  return { inventaires, mouvements, defaut: { inventaireId: inv?.id ?? null, mouvementsIds } };
}

async function mouvementsCreesPar(client: Client, batchIds: string[], libelles: Map<string, string>): Promise<MvtDoublon[]> {
  const ops = await client.importOperation.findMany({
    where: { batchId: { in: batchIds }, entite: "MouvementStock", action: "CREATE" },
    select: { batchId: true, entiteId: true },
  });
  const lotDe = new Map(ops.map((o) => [o.entiteId, o.batchId]));
  const mvts = await client.mouvementStock.findMany({
    where: { id: { in: ops.map((o) => o.entiteId) } },
    select: { id: true, articleId: true, date: true, type: true, quantite: true, article: { select: { designation: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return mvts.map((m) => ({
    id: m.id, articleId: m.articleId, article: m.article.designation, date: datePure(m.date), type: m.type,
    quantite: Number(m.quantite), batchId: lotDe.get(m.id)!, libelle: libelles.get(lotDe.get(m.id)!) ?? "",
  }));
}

/** Aperçu (aucune écriture) des mouvements en double entre un import d'inventaire et des imports de mouvements. */
export async function detecterDoublons(inventaireId: string, mouvementsIds: string[], client: Client = prisma): Promise<ApercuDoublons> {
  const inv = await client.importBatch.findUnique({ where: { id: inventaireId }, select: { id: true, libelle: true, type: true, statut: true, createdAt: true } });
  if (!inv || inv.type !== "INVENTAIRE") throw new Error("Choisissez un import d'inventaire (celui dont les copies seront retirées).");
  if (inv.statut !== "APPLIQUE") throw new Error(`L'import « ${inv.libelle} » est annulé : il n'a plus de mouvements.`);
  const ids = [...new Set(mouvementsIds)];
  if (ids.length === 0) throw new Error("Choisissez au moins un import de mouvements (celui dont les copies sont conservées).");
  const mvs = await client.importBatch.findMany({ where: { id: { in: ids } }, select: { id: true, libelle: true, type: true, statut: true, createdAt: true } });
  const pasMouvements = ids.filter((id) => !mvs.some((b) => b.id === id && b.type === "MOUVEMENTS"));
  if (pasMouvements.length > 0) throw new Error("Seul un import de mouvements peut servir de référence (copies conservées).");
  const annule = mvs.find((b) => b.statut !== "APPLIQUE");
  if (annule) throw new Error(`L'import « ${annule.libelle} » est annulé : il ne peut pas servir de référence.`);

  const libelles = new Map([[inv.id, inv.libelle], ...mvs.map((b) => [b.id, b.libelle] as [string, string])]);
  const candidats = await mouvementsCreesPar(client, [inv.id], libelles);
  const referencesToutes = await mouvementsCreesPar(client, ids, libelles);

  // Une copie conservée qui a DÉJÀ servi de jumeau (nettoyage précédent, ou mouvement ignoré à
  // un import) ne ressert pas : sinon, relancé, l'outil apparierait un mouvement légitime.
  const servis = referencesToutes.length === 0 ? [] : await client.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT o.avant->>'jumeauId' AS id FROM "stock"."ImportOperation" o
    WHERE o.action IN ('DOUBLON_RETIRE', 'DEJA_PRESENT') AND o.avant->>'jumeauId' = ANY(${referencesToutes.map((r) => r.id)}::text[])`;
  const dejaServis = new Set(servis.map((s) => s.id));
  const references = referencesToutes.filter((r) => !dejaServis.has(r.id));

  const r = apparierUnAUn(references, candidats);
  const paires = r.paires.map((p) => ({ retire: p.candidat, garde: p.reference }));
  const c = controleApresRetrait(references, candidats, new Set(paires.map((p) => p.retire.id)));
  const nomArticle = new Map([...references, ...candidats].map((m) => [m.articleId, m.article]));

  return {
    inventaire: lot(inv),
    mouvements: mvs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(lot),
    paires,
    sansJumeauInventaire: r.candidatsSeuls,
    sansJumeauMouvements: r.referencesSeules,
    controle: { verifies: c.verifies, ecarts: c.ecarts.map((e) => ({ ...e, article: nomArticle.get(e.articleId) ?? e.articleId })) },
  };
}

/**
 * Retire, en une transaction, les copies de l'import d'INVENTAIRE choisies parmi les paires
 * jumelles (recalculées ici : la sélection du client n'est jamais crue sur parole). Ne touche NI
 * au stock, NI aux légumes, NI aux articles. Requalifie les opérations d'import (« Annuler
 * l'import » ne les rejoue plus) et journalise. Tout ou rien.
 */
export async function retirerDoublons(inventaireId: string, mouvementsIds: string[], idsARetirer: string[], userId: string): Promise<{ retires: number; message: string }> {
  const ids = [...new Set(idsARetirer)];
  if (ids.length === 0) throw new Error("Cochez au moins un mouvement en double à retirer.");

  return prisma.$transaction(async (tx) => {
    // Deux retraits simultanés : le second attend, puis ne retrouve plus les mêmes doublons.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('stock.doublons-imports'))`;
    const a = await detecterDoublons(inventaireId, mouvementsIds, tx);
    const parId = new Map(a.paires.map((p) => [p.retire.id, p]));
    const perimes = ids.filter((id) => !parId.has(id));
    if (perimes.length > 0) {
      throw new Error(`${perimes.length} mouvement(s) sélectionné(s) ne sont plus des doublons de ces imports (déjà retirés ?) : relancez la recherche. Rien n'a été retiré.`);
    }
    const paires = ids.map((id) => parId.get(id)!);
    await exigerPeriodesOuvertes(paires.map((p) => jour(p.retire.date)));

    const sup = await tx.mouvementStock.deleteMany({ where: { id: { in: ids } } });
    if (sup.count !== ids.length) throw new Error("Des mouvements ont changé pendant le retrait : relancez la recherche. Rien n'a été retiré.");

    // Requalifie les opérations CREATE des copies retirées, en UNE requête (602 allers-retours
    // vers la base, depuis Render, dépasseraient le délai de la transaction). La trace a la même
    // forme que `traceJumeau` : le mouvement retiré tel qu'il était, et le jumeau conservé.
    const retireLe = new Date().toISOString();
    const col = (f: (p: (typeof paires)[number]) => string) => paires.map(f);
    const maj = await tx.$executeRaw`
      UPDATE "stock"."ImportOperation" o
      SET action = ${ACTION_DOUBLON_RETIRE},
          avant = jsonb_build_object(
            'jumeauId', t.garde, 'articleId', t.article, 'date', t.d, 'type', t.type, 'quantite', t.q,
            'jumeauBatchId', t.garde_lot, 'retireLe', ${retireLe}::text, 'retireParId', ${userId}::text)
      FROM unnest(
        ${col((p) => p.retire.id)}::text[], ${col((p) => p.garde.id)}::text[], ${col((p) => p.garde.batchId)}::text[],
        ${col((p) => p.retire.articleId)}::text[], ${col((p) => p.retire.date)}::text[], ${col((p) => p.retire.type)}::text[],
        ${col((p) => String(p.retire.quantite))}::text[]
      ) AS t(retire, garde, garde_lot, article, d, type, q)
      WHERE o."batchId" = ${inventaireId} AND o.entite = 'MouvementStock' AND o.action = 'CREATE' AND o."entiteId" = t.retire`;
    if (maj !== ids.length) throw new Error("Le journal de l'import a changé pendant le retrait : relancez la recherche. Rien n'a été retiré.");

    const conserves = [...new Set(paires.map((p) => `« ${p.garde.libelle} »`))].join(", ");
    const message = `${ids.length} mouvement(s) en double retiré(s) de « ${a.inventaire.libelle} » ; leurs jumeaux restent dans ${conserves}. Le stock n'a pas bougé.`;
    await journaliser(tx, {
      entite: "MouvementStock",
      entiteId: inventaireId,
      champ: "suppression (doublons d'import)",
      ancienneValeur: ids.join(","),
      nouvelleValeur: message,
      userId,
    });
    return { retires: ids.length, message };
  }, { timeout: 120000 });
}
