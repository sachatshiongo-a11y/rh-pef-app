import "server-only";

// FOURNISSEURS D'UN ARTICLE (2026-10-16) — le SEUL chemin d'écriture de la liaison `ArticleFournisseur` et de la
// copie de compatibilité `ArticleStock.fournisseurId` (le fournisseur HABITUEL).
//
// Deux sortes d'écriture, deux régimes (principe de la Direction : « elle valide les changements des autres
// rôles ») :
//  - ALIMENTATION AUTOMATIQUE par un achat réel (Liste d'achat, facture, bon de commande validé, réception) :
//    c'est un FAIT constaté, pas une décision — le fournisseur rejoint la liste de l'article s'il n'y est pas,
//    sans validation, avec une ligne au journal. Elle ne marque JAMAIS d'habituel (cela reste une décision) et
//    n'enlève jamais rien.
//  - GESTE MANUEL (ajouter / retirer un fournisseur, changer l'habituel) : Direction = écriture directe ; autre
//    rôle = proposition « À valider » (champs `fournisseursIds` et `fournisseurId` d'un patch d'article, voir
//    validations-stock/article.ts, qui appelle ce fichier à l'approbation).
//
// Hors fichier « use server » : ces fonctions sont des CŒURS d'écriture, jamais des actions appelables du dehors.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { WHERE_ACHATS_LISTE } from "@/lib/achats-liste";
import { achatDeLigneBon, achatDeLigneFacture, achatDeMouvement, comparerPrix, dernierPrixParFournisseur, STATUTS_BON_ENGAGES, type AchatFournisseur, type ComparaisonPrix, type UnitesArticle } from "@/lib/prix-fournisseurs";

type Tx = Prisma.TransactionClient;

export type SourceLien = "MANUEL" | "LISTE_ACHAT" | "FACTURE" | "BON_COMMANDE" | "RECEPTION" | "FUSION" | "CREATION";
export const LIBELLE_SOURCE: Record<SourceLien, string> = {
  MANUEL: "ajouté à la main", LISTE_ACHAT: "achat de la Liste d'achat", FACTURE: "facture", BON_COMMANDE: "bon de commande", RECEPTION: "réception d'un bon", FUSION: "fusion", CREATION: "création de l'article",
};

/** Verrouille les lignes d'articles (ordre fixe : deux gestes simultanés sur les mêmes articles ne s'interbloquent pas). */
export async function verrouillerArticlesTx(tx: Tx, ids: string[]) {
  const uniques = [...new Set(ids)].sort();
  if (uniques.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "stock"."ArticleStock" WHERE "id" IN (${Prisma.join(uniques)}) ORDER BY "id" FOR UPDATE`;
}

export type Paire = { articleId: string | null | undefined; fournisseurId: string | null | undefined };

/**
 * ALIMENTATION AUTOMATIQUE. Ajoute chaque fournisseur à la liste de son article s'il n'y est pas ; ne touche pas à
 * ce qui existe (habituel compris). Idempotent (`ON CONFLICT DO NOTHING`) : deux achats simultanés du même couple
 * n'en font qu'un. Les paires sans article ou sans fournisseur (ligne libre, achat sans fournisseur) sont ignorées.
 * Rend les couples AJOUTÉS ; chacun laisse une ligne au journal de l'article. À appeler DANS la transaction de
 * l'achat : l'achat annulé n'ajoute rien.
 */
export async function alimenterFournisseursTx(tx: Tx, paires: readonly Paire[], source: SourceLien, userId: string | null): Promise<{ articleId: string; fournisseurId: string }[]> {
  const uniques = new Map<string, { articleId: string; fournisseurId: string }>();
  for (const p of paires) if (p.articleId && p.fournisseurId) uniques.set(`${p.articleId}|${p.fournisseurId}`, { articleId: p.articleId, fournisseurId: p.fournisseurId });
  if (uniques.size === 0) return [];
  const ajoutes = await tx.articleFournisseur.createManyAndReturn({
    data: [...uniques.values()].map((p) => ({ ...p, habituel: false, source })),
    skipDuplicates: true,
    select: { articleId: true, fournisseurId: true },
  });
  if (ajoutes.length > 0 && userId) {
    const noms = new Map((await tx.fournisseur.findMany({ where: { id: { in: [...new Set(ajoutes.map((a) => a.fournisseurId))] } }, select: { id: true, nom: true } })).map((f) => [f.id, f.nom]));
    const entrees: EntreeJournal[] = ajoutes.map((a) => ({ entite: "ArticleStock", entiteId: a.articleId, champ: "fournisseur ajouté", nouvelleValeur: `${noms.get(a.fournisseurId) ?? a.fournisseurId} (auto — ${LIBELLE_SOURCE[source]})`, userId }));
    await journaliserPlusieurs(tx, entrees);
  }
  return ajoutes;
}

/**
 * Fournisseur HABITUEL d'un article (`null` = plus d'habituel). Le fournisseur rejoint la liste s'il n'y était pas ;
 * l'ancien habituel y reste, non habituel ; la copie `ArticleStock.fournisseurId` suit. Verrouille l'article.
 */
export async function definirHabituelTx(tx: Tx, articleId: string, fournisseurId: string | null, source: SourceLien = "MANUEL") {
  await verrouillerArticlesTx(tx, [articleId]);
  await tx.articleFournisseur.updateMany({ where: { articleId, habituel: true, ...(fournisseurId ? { NOT: { fournisseurId } } : {}) }, data: { habituel: false } });
  if (fournisseurId) {
    await tx.articleFournisseur.upsert({
      where: { articleId_fournisseurId: { articleId, fournisseurId } },
      update: { habituel: true },
      create: { articleId, fournisseurId, habituel: true, source },
    });
  }
  await tx.articleStock.update({ where: { id: articleId }, data: { fournisseurId } });
}

/**
 * Remplace la liste des fournisseurs d'un article par `ids` (les manquants sont ajoutés, les absents retirés).
 * Retirer l'habituel laisse l'article SANS habituel (rien n'est choisi à sa place) et vide la copie de
 * compatibilité. Verrouille l'article. Rend ce qui a été ajouté et retiré.
 */
export async function remplacerFournisseursTx(tx: Tx, articleId: string, ids: readonly string[], source: SourceLien = "MANUEL") {
  await verrouillerArticlesTx(tx, [articleId]);
  const voulus = new Set(ids);
  const existants = await tx.articleFournisseur.findMany({ where: { articleId }, select: { fournisseurId: true, habituel: true } });
  const retires = existants.filter((e) => !voulus.has(e.fournisseurId));
  const presents = new Set(existants.map((e) => e.fournisseurId));
  const ajoutes = [...voulus].filter((f) => !presents.has(f));
  if (retires.length > 0) await tx.articleFournisseur.deleteMany({ where: { articleId, fournisseurId: { in: retires.map((r) => r.fournisseurId) } } });
  if (ajoutes.length > 0) await tx.articleFournisseur.createMany({ data: ajoutes.map((fournisseurId) => ({ articleId, fournisseurId, habituel: false, source })), skipDuplicates: true });
  if (retires.some((r) => r.habituel)) await tx.articleStock.update({ where: { id: articleId }, data: { fournisseurId: null } });
  return { ajoutes, retires: retires.map((r) => r.fournisseurId) };
}

/**
 * Le même fournisseur HABITUEL pour plusieurs articles d'un coup (action groupée de l'Inventaire). Il rejoint la
 * liste de chacun ; l'ancien habituel y reste, non habituel ; la copie de compatibilité suit. `null` : plus
 * d'habituel (les listes ne changent pas). Rend le nombre d'articles dont l'habituel a CHANGÉ.
 */
export async function definirHabituelEnMasseTx(tx: Tx, articleIds: readonly string[], fournisseurId: string | null, source: SourceLien = "MANUEL"): Promise<number> {
  const ids = [...new Set(articleIds)];
  if (ids.length === 0) return 0;
  await verrouillerArticlesTx(tx, ids);
  const avant = await tx.articleFournisseur.findMany({ where: { articleId: { in: ids }, habituel: true }, select: { articleId: true, fournisseurId: true } });
  const dejaBons = new Set(avant.filter((a) => a.fournisseurId === fournisseurId).map((a) => a.articleId));
  const aChanger = ids.filter((i) => !dejaBons.has(i) && (fournisseurId !== null || avant.some((a) => a.articleId === i)));
  if (aChanger.length === 0) return 0;
  await tx.articleFournisseur.updateMany({ where: { articleId: { in: aChanger }, habituel: true }, data: { habituel: false } });
  if (fournisseurId) {
    await tx.articleFournisseur.createMany({ data: aChanger.map((articleId) => ({ articleId, fournisseurId, habituel: false, source })), skipDuplicates: true });
    await tx.articleFournisseur.updateMany({ where: { articleId: { in: aChanger }, fournisseurId }, data: { habituel: true } });
  }
  await tx.articleStock.updateMany({ where: { id: { in: aChanger } }, data: { fournisseurId } });
  return aChanger.length;
}

/** Ajoute ces fournisseurs à ces articles (action groupée) sans toucher à l'habituel. Rend le nombre de liens créés. */
export async function ajouterFournisseursEnMasseTx(tx: Tx, articleIds: readonly string[], fournisseurIds: readonly string[], source: SourceLien = "MANUEL"): Promise<number> {
  const ids = [...new Set(articleIds)], fours = [...new Set(fournisseurIds)];
  if (ids.length === 0 || fours.length === 0) return 0;
  await verrouillerArticlesTx(tx, ids);
  const r = await tx.articleFournisseur.createMany({ data: ids.flatMap((articleId) => fours.map((fournisseurId) => ({ articleId, fournisseurId, habituel: false, source }))), skipDuplicates: true });
  return r.count;
}

/**
 * Retire ces fournisseurs de ces articles (action groupée). Un habituel retiré laisse l'article sans habituel (la
 * copie de compatibilité est vidée) : rien n'est choisi à sa place. Rend le nombre de liens retirés.
 */
export async function retirerFournisseursEnMasseTx(tx: Tx, articleIds: readonly string[], fournisseurIds: readonly string[]): Promise<number> {
  const ids = [...new Set(articleIds)], fours = [...new Set(fournisseurIds)];
  if (ids.length === 0 || fours.length === 0) return 0;
  await verrouillerArticlesTx(tx, ids);
  const habituels = await tx.articleFournisseur.findMany({ where: { articleId: { in: ids }, fournisseurId: { in: fours }, habituel: true }, select: { articleId: true } });
  const r = await tx.articleFournisseur.deleteMany({ where: { articleId: { in: ids }, fournisseurId: { in: fours } } });
  if (habituels.length > 0) await tx.articleStock.updateMany({ where: { id: { in: habituels.map((h) => h.articleId) } }, data: { fournisseurId: null } });
  return r.count;
}

/** Les fournisseurs de chaque article (ids triés), tels que la valeur `fournisseursIds` d'un patch les compare. */
export async function idsFournisseursParArticleTx(tx: Tx, articleIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (articleIds.length === 0) return m;
  for (const l of await tx.articleFournisseur.findMany({ where: { articleId: { in: articleIds } }, select: { articleId: true, fournisseurId: true } })) {
    const arr = m.get(l.articleId) ?? [];
    arr.push(l.fournisseurId);
    m.set(l.articleId, arr);
  }
  for (const arr of m.values()) arr.sort();
  return m;
}

/**
 * FUSION D'ARTICLES : les fournisseurs des doublons passent à l'article conservé, sans doublon de couple. Le
 * fournisseur habituel de l'article conservé reste le sien ; s'il n'en a pas, il adopte celui d'un doublon (le
 * premier, dans l'ordre reçu). À appeler AVANT la suppression des doublons (leurs liens partent en cascade).
 */
export async function reporterFournisseursDesDoublonsTx(tx: Tx, keepId: string, loserIds: readonly string[]): Promise<{ reportes: number; habituelAdopte: string | null }> {
  if (loserIds.length === 0) return { reportes: 0, habituelAdopte: null };
  await verrouillerArticlesTx(tx, [keepId, ...loserIds]);
  const surGarde = await tx.articleFournisseur.findMany({ where: { articleId: keepId }, select: { fournisseurId: true, habituel: true } });
  const deja = new Set(surGarde.map((l) => l.fournisseurId));
  let habituelPris = surGarde.some((l) => l.habituel);
  const rang = new Map(loserIds.map((id, i) => [id, i]));
  const deDoublons = (await tx.articleFournisseur.findMany({ where: { articleId: { in: [...loserIds] } }, select: { articleId: true, fournisseurId: true, habituel: true, createdAt: true } }))
    .sort((a, b) => (rang.get(a.articleId) ?? 0) - (rang.get(b.articleId) ?? 0) || Number(b.habituel) - Number(a.habituel) || a.createdAt.getTime() - b.createdAt.getTime());
  let reportes = 0;
  let habituelAdopte: string | null = null;
  for (const l of deDoublons) {
    if (deja.has(l.fournisseurId)) continue;
    deja.add(l.fournisseurId);
    const habituel = !habituelPris && l.habituel;
    if (habituel) { habituelPris = true; habituelAdopte = l.fournisseurId; }
    await tx.articleFournisseur.create({ data: { articleId: keepId, fournisseurId: l.fournisseurId, habituel, source: "FUSION" } });
    reportes++;
  }
  if (habituelAdopte) await tx.articleStock.update({ where: { id: keepId }, data: { fournisseurId: habituelAdopte } });
  return { reportes, habituelAdopte };
}

/**
 * FUSION DE FOURNISSEURS : les articles de `sourceId` passent à `cibleId`, sans doublon de couple. Un article qui
 * avait les deux garde un seul lien, habituel si l'un des deux l'était. À appeler AVANT la suppression de la source.
 * La copie `ArticleStock.fournisseurId` est reportée par l'appelant (`updateMany`), comme avant.
 */
export async function reporterArticlesDuFournisseurTx(tx: Tx, sourceId: string, cibleId: string): Promise<{ repointes: number; fusionnes: number }> {
  const deLaSource = await tx.articleFournisseur.findMany({ where: { fournisseurId: sourceId }, select: { id: true, articleId: true, habituel: true } });
  if (deLaSource.length === 0) return { repointes: 0, fusionnes: 0 };
  const surCible = new Map((await tx.articleFournisseur.findMany({ where: { fournisseurId: cibleId, articleId: { in: deLaSource.map((l) => l.articleId) } }, select: { id: true, articleId: true, habituel: true } })).map((l) => [l.articleId, l]));
  const doublons = deLaSource.filter((l) => surCible.has(l.articleId));
  const simples = deLaSource.filter((l) => !surCible.has(l.articleId));
  // Le lien de la source part d'abord (jamais deux habituels, jamais deux fois le même couple) ; l'habituel passe à la cible.
  if (doublons.length > 0) await tx.articleFournisseur.deleteMany({ where: { id: { in: doublons.map((l) => l.id) } } });
  for (const l of doublons) if (l.habituel && !surCible.get(l.articleId)!.habituel) await tx.articleFournisseur.update({ where: { id: surCible.get(l.articleId)!.id }, data: { habituel: true } });
  if (simples.length > 0) await tx.articleFournisseur.updateMany({ where: { id: { in: simples.map((l) => l.id) } }, data: { fournisseurId: cibleId } });
  return { repointes: simples.length, fusionnes: doublons.length };
}

// ── Lectures ─────────────────────────────────────────────────────────────────

/** Les liens de tous les articles (ou de ceux donnés), à plat — pour ordonner les fournisseurs proposés. */
export async function chargerLiensFournisseurs(articleIds?: string[]): Promise<{ articleId: string; fournisseurId: string; habituel: boolean }[]> {
  return prisma.articleFournisseur.findMany({
    ...(articleIds ? { where: { articleId: { in: articleIds } } } : {}),
    select: { articleId: true, fournisseurId: true, habituel: true },
    orderBy: [{ articleId: "asc" }, { fournisseurId: "asc" }],
  });
}

/** L'historique d'achats d'un article, chez les fournisseurs connus : Liste d'achat, lignes de facture, lignes de bon engagé. */
export async function chargerAchatsParFournisseur(articleId: string): Promise<AchatFournisseur[]> {
  const [mouvements, lignesFacture, lignesBon] = await Promise.all([
    prisma.mouvementStock.findMany({
      where: { AND: [WHERE_ACHATS_LISTE, { articleId, fournisseurId: { not: null } }] },
      select: { fournisseurId: true, date: true, quantite: true, devise: true, montantOrigine: true, montantUSD: true },
    }),
    prisma.ligneFacture.findMany({
      where: { articleId, facture: { fournisseurId: { not: null }, date: { not: null } } },
      select: { prixUnitaireUSD: true, prixUnitaireCDF: true, unite: true, facture: { select: { id: true, numero: true, date: true, fournisseurId: true, devise: true } } },
    }),
    prisma.ligneBonDeCommande.findMany({
      where: { articleId, bonDeCommande: { fournisseurId: { not: null }, statut: { in: [...STATUTS_BON_ENGAGES] } } },
      select: { prixUnitaireUSD: true, prixUnitaireCDF: true, unite: true, bonDeCommande: { select: { id: true, numero: true, date: true, fournisseurId: true, devise: true, statut: true } } },
    }),
  ]);
  return [
    ...mouvements.map((m) => achatDeMouvement(m)),
    ...lignesFacture.map((l) => achatDeLigneFacture({ prixUnitaireUSD: l.prixUnitaireUSD, prixUnitaireCDF: l.prixUnitaireCDF, unite: l.unite, facture: l.facture })),
    ...lignesBon.map((l) => achatDeLigneBon({ prixUnitaireUSD: l.prixUnitaireUSD, prixUnitaireCDF: l.prixUnitaireCDF, unite: l.unite, bon: l.bonDeCommande })),
  ].filter((a): a is AchatFournisseur => a !== null);
}

/** Dernier prix de chaque fournisseur d'un article, classé (voir `prix-fournisseurs.ts`). */
export async function chargerPrixParFournisseur(articleId: string, article: UnitesArticle, taux: number | null): Promise<ComparaisonPrix> {
  return comparerPrix(dernierPrixParFournisseur(await chargerAchatsParFournisseur(articleId), article), taux);
}
