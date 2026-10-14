import "server-only";

// SUPPRESSION D'ARTICLES DU CATALOGUE — un seul chemin pour la fiche article (un article) et pour la barre
// d'actions groupées de l'Inventaire (plusieurs). Décision de la Direction du 2026-10-14 : « on ne peut pas
// supprimer des articles de l'inventaire ».
//
// La règle ne change pas, elle devient lisible : un article n'est supprimé que s'il n'a AUCUN historique.
// La traçabilité prime : `MouvementStock` est en `onDelete: Cascade` — supprimer un article qui a des mouvements
// EFFACERAIT son historique de stock. Un article avec historique est donc CONSERVÉ, avec sa raison nommée, et
// la Direction le désactive (il disparaît des listes) ou le fusionne avec un doublon.
//
// Historique = mouvements, lignes de facture, lignes de bon de commande, commandes du restaurant, comptages,
// lignes de fiche technique (`IngredientFiche` est en `Restrict`), et toute demande « À valider » en attente
// sur l'article (la supprimer la rendrait inexécutable).
//
// Hors fichier « use server » (comme article.ts) : la garde « Direction seule » est dans les actions.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";
import { formaterNombre } from "@/lib/montant";
import { cleArticle, cleComptage, cleMouvement } from "./charge";
import { historiqueDesArticles } from "./historique-article";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

export type ArticleSupprimable = {
  /** `designation` : le nom AFFICHÉ (contenance comprise) ; `nom` : la désignation enregistrée, celle que le journal garde. */
  id: string; designation: string; nom: string;
  /** Stock EFFACÉ avec l'article (« 12 kg ») quand il n'est pas nul ; null : stock vide ou absent. */
  stock: string | null;
  /** Rattachements au restaurant retirés avec l'article (cascade). */
  liensResto: number;
};
export type ArticleConserve = {
  id: string; designation: string;
  /** « 12 mouvements », « 3 lignes de facture »… — ce qui retient l'article. */
  attaches: string[];
  /** « Farine : 12 mouvements, 3 lignes de facture ». */
  raison: string;
};
export type BilanSuppression = { supprimables: ArticleSupprimable[]; conserves: ArticleConserve[]; introuvables: number };

const pl = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const uniques = (ids: readonly string[]) => [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(Boolean);

/**
 * Pour chaque article demandé : supprimable (aucun historique) ou conservé (avec ce qui le retient).
 * LECTURE SEULE. Les requêtes partent l'une après l'autre : `client` peut être une transaction.
 */
export async function bilanSuppression(client: Client, idsDemandes: readonly string[]): Promise<BilanSuppression> {
  const ids = uniques(idsDemandes);
  if (ids.length === 0) return { supprimables: [], conserves: [], introuvables: 0 };
  const db = client as typeof prisma; // une transaction offre les mêmes lectures ; le type d'union des deux ne résout pas les `groupBy`
  const arts = await db.articleStock.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...CHAMPS_LIBELLE, unite: true, stock: { select: { quantite: true, quantiteEndommagee: true } }, _count: { select: { liensResto: true } } },
  });
  const historique = await historiqueDesArticles(db, ids);
  // `IngredientFiche.articleId` est en `onDelete: Restrict` : sans ce contrôle, la suppression échouerait sur une
  // violation de contrainte Postgres brute. On NOMME les fiches : c'est là qu'il faut retirer l'ingrédient.
  const ingredients = await db.ingredientFiche.findMany({ where: { articleId: { in: ids } }, select: { articleId: true, fiche: { select: { nom: true } } } });
  const fichesDe = new Map<string, string[]>();
  for (const i of ingredients) fichesDe.set(i.articleId!, [...(fichesDe.get(i.articleId!) ?? []), i.fiche.nom]);
  // Une demande « À valider » en attente sur l'article (modification, comptage, mouvement) : l'article reste jusqu'à la décision.
  const cles = await db.cibleDemandeStock.findMany({ where: { cle: { in: ids.flatMap((id) => [cleArticle(id), cleComptage(id), cleMouvement(id)]) } }, select: { cle: true } });
  const enAttente = new Set(cles.map((c) => c.cle.slice(c.cle.indexOf(":") + 1)));

  const supprimables: ArticleSupprimable[] = [];
  const conserves: ArticleConserve[] = [];
  for (const a of arts) {
    const attaches: string[] = [];
    const h = historique.get(a.id)!;
    const nbMvts = h.mouvements, nbFac = h.lignesFacture, nbBC = h.lignesBon, nbCmd = h.commandesResto, nbCpt = h.comptages;
    const fiches = fichesDe.get(a.id) ?? [];
    if (nbMvts) attaches.push(pl(nbMvts, "mouvement"));
    if (nbFac) attaches.push(pl(nbFac, "ligne de facture", "lignes de facture"));
    if (nbBC) attaches.push(pl(nbBC, "ligne de bon de commande", "lignes de bon de commande"));
    if (nbCmd) attaches.push(pl(nbCmd, "commande resto", "commandes resto"));
    if (nbCpt) attaches.push(pl(nbCpt, "comptage"));
    if (fiches.length) attaches.push(`${pl(fiches.length, "ligne de fiche technique", "lignes de fiche technique")} (${[...new Set(fiches)].map((n) => `« ${n} »`).join(", ")})`);
    if (enAttente.has(a.id)) attaches.push("une demande en attente de la Direction (À valider)");
    const designation = libelleArticle(a);
    if (attaches.length > 0) { conserves.push({ id: a.id, designation, attaches, raison: `${designation} : ${attaches.join(", ")}` }); continue; }
    const q = a.stock?.quantite, endommage = a.stock?.quantiteEndommagee;
    const unite = a.unite?.trim() ? ` ${a.unite.trim()}` : "";
    const morceaux = [
      q && !q.isZero() ? `${formaterNombre(Number(q), { maximumFractionDigits: 3 })}${unite}` : null,
      endommage && !endommage.isZero() ? `${formaterNombre(Number(endommage), { maximumFractionDigits: 3 })}${unite} endommagé(s)` : null,
    ].filter(Boolean);
    supprimables.push({ id: a.id, designation, nom: a.designation, stock: morceaux.length ? morceaux.join(" + ") : null, liensResto: a._count.liensResto });
  }
  const parNom = (x: { designation: string }, y: { designation: string }) => x.designation.localeCompare(y.designation, "fr");
  return { supprimables: supprimables.sort(parNom), conserves: conserves.sort(parNom), introuvables: ids.length - arts.length };
}

/** Phrase d'un article conservé pour un refus unique (fiche article) : même texte qu'avant la suppression en lot. */
export const messageConservation = (c: ArticleConserve) =>
  `« ${c.designation} » a un historique (${c.attaches.join(", ")}) : il ne peut pas être supprimé. Désactivez-le (il disparaît des listes), retirez-le des fiches techniques qui l'utilisent, ou fusionnez-le avec un doublon.`;

/**
 * Supprime, dans la transaction `tx`, ceux des articles demandés qui n'ont AUCUN historique ; les autres ne
 * sont pas touchés. Lignes d'article et de stock VERROUILLÉES (`FOR UPDATE`, ids triés) avant le contrôle : un
 * mouvement saisi au même instant est attendu puis vu — jamais effacé par la cascade. Une erreur annule tout
 * (la transaction), y compris le journal. À n'appeler qu'après la garde « Direction ».
 */
export async function supprimerArticlesSansHistoriqueTx(tx: Tx, userId: string, idsDemandes: readonly string[]): Promise<BilanSuppression> {
  const ids = uniques(idsDemandes).sort();
  if (ids.length === 0) return { supprimables: [], conserves: [], introuvables: 0 };
  await tx.$queryRaw`SELECT "id" FROM "stock"."ArticleStock" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "stock"."Stock" WHERE "articleId" IN (${Prisma.join(ids)}) ORDER BY "articleId" FOR UPDATE`;
  const bilan = await bilanSuppression(tx, ids);
  const aSupprimer = bilan.supprimables.map((a) => a.id);
  if (aSupprimer.length === 0) return bilan;
  await tx.stock.deleteMany({ where: { articleId: { in: aSupprimer } } });
  await tx.articleStock.deleteMany({ where: { id: { in: aSupprimer } } });
  const journal: EntreeJournal[] = bilan.supprimables.map((a) => ({
    entite: "ArticleStock", entiteId: a.id, champ: "suppression",
    ancienneValeur: `${a.nom}${a.stock ? ` — stock effacé avec l'article : ${a.stock}` : ""}${a.liensResto ? ` — ${pl(a.liensResto, "rattachement")} au restaurant retiré(s)` : ""}`.slice(0, 900),
    userId,
  }));
  if (aSupprimer.length > 1 || bilan.conserves.length > 0) {
    journal.push({
      entite: "ArticleStock", entiteId: `${aSupprimer.length} articles`, champ: "suppression (masse)", userId,
      nouvelleValeur: `${aSupprimer.length} supprimé(s) · ${bilan.conserves.length} conservé(s) car ils ont un historique`,
    });
  }
  await journaliserPlusieurs(tx, journal);
  return bilan;
}
