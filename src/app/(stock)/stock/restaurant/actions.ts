"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisiOptionnel } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs } from "@/lib/audit";
import { proposerRattachements } from "@/lib/fiches/rattachement-resto";
import { messageDesactivation, stocksComptesResto } from "@/lib/stock-restaurant-charger";
import { rattacherAutomatiquement } from "@/lib/rattachement-auto";
import { libelleArticle } from "@/lib/libelle-article";
import { demanderLiensResto, estDirection } from "@/lib/validations-stock/demandes";
import { obstaclesLiens, poserLiensTx, retirerLiensTx } from "@/lib/validations-stock/lien-resto";
import type { OperationLien } from "@/lib/validations-stock/charge";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";
import { exigerJourSaisissable, lireJourSaisie } from "@/lib/saisie-restaurant";
import { MOTIF_LIVRAISON_RESTAURANT } from "@/lib/stock-restaurant";
import { normaliserUnite } from "@/lib/fiches/conversion";

/** Borne d'un lot du bouton « Rattacher automatiquement » (une semaine d'arriéré en compte ~25). */
const MAX_RATTACHEMENT_AUTO = 200;


async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/**
 * Met à jour le comptage d'un article resto pour une date donnée (upsert ; vide = suppression).
 * Mêmes garanties que la saisie des ventes (audit 2026-10-10) : une période de stock clôturée est en
 * lecture seule, chaque changement est journalisé (avant → après) et la ligne garde l'auteur et
 * l'horodatage de sa dernière saisie. Rien ne change (même valeur) : ni écriture, ni journal.
 */
export const majComptage = actionLisible(async (articleRestoId: string, dateISO: string, valeur: string) => {
  const user = await garde();
  // Un article désactivé ne se compte plus (sinon son stock reviendrait en douce) : refus lisible.
  const article = await prisma.articleResto.findUnique({ where: { id: articleRestoId }, select: { actif: true, designation: true } });
  if (!article) throw new Error("Article du restaurant introuvable. Rechargez la page.");
  if (!article.actif) throw new Error(`« ${article.designation} » est désactivé : la Direction doit le réactiver avant tout comptage.`);
  const date = lireJourSaisie(dateISO, "de comptage");
  const q = decSaisiOptionnel(valeur, "comptage");
  await exigerJourSaisissable(date, "les comptages");
  await prisma.$transaction(async (tx) => {
    const avant = await tx.comptageResto.findUnique({ where: { articleRestoId_date: { articleRestoId, date } }, select: { quantite: true } });
    if (q === null) {
      if (!avant) return; // rien à retirer : idempotent, pas de journal
      await tx.comptageResto.deleteMany({ where: { articleRestoId, date } });
    } else {
      if (avant && avant.quantite.equals(q)) return; // même valeur : ni écriture, ni journal, l'auteur reste celui de la vraie saisie
      await tx.comptageResto.upsert({
        where: { articleRestoId_date: { articleRestoId, date } },
        update: { quantite: q, saisiParId: user.id, saisiLe: new Date() },
        create: { articleRestoId, date, quantite: q, saisiParId: user.id, saisiLe: new Date() },
      });
    }
    await journaliser(tx, {
      entite: "ComptageResto", entiteId: `${articleRestoId}_${dateISO}`, champ: "quantite",
      ancienneValeur: avant ? avant.quantite.toString() : null, nouvelleValeur: q, userId: user.id,
    });
  });
  revalidatePath("/stock/restaurant");
});

/** Ajoute un article au stock restaurant. */
export const creerArticleResto = actionLisible(async (formData: FormData) => {
  await garde();
  const espace = String(formData.get("espace") ?? "CUISINE") === "BAR" ? "BAR" : "CUISINE";
  const designation = String(formData.get("designation") ?? "").trim();
  if (!designation) throw new Error("La désignation est requise.");
  const dernier = await prisma.articleResto.aggregate({ where: { espace }, _max: { ordre: true } });
  await prisma.articleResto.create({
    data: {
      espace, designation,
      categorie: String(formData.get("categorie") ?? "").trim() || null,
      unite: String(formData.get("unite") ?? "").trim() || null,
      stockBaseJournalier: decSaisiOptionnel(formData.get("stockBaseJournalier"), "stock de base"),
      ordre: (dernier._max.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/stock/restaurant");
});

/**
 * Modifie un champ d'un article resto (désignation, catégorie, unité, base, ordre).
 *
 * L'UNITÉ est celle de tout l'historique : un comptage ne porte pas la sienne, et les livraisons du
 * dépôt sont converties dans cette unité. La changer une fois qu'un comptage ou une livraison existe
 * réinterprète tout le passé sans trace (4,5 kg deviendrait 4,5 g — audit 2026-10-10) : REFUSÉ, avec
 * le chemin à suivre. Une unité jamais renseignée peut être posée (rien n'est réinterprété). Tout
 * changement accepté est journalisé (avant → après).
 */
export const modifierArticleResto = actionLisible(async (id: string, formData: FormData) => {
  const user = await garde();
  const data: Record<string, unknown> = {};
  if (formData.has("designation")) {
    const v = String(formData.get("designation") ?? "").trim();
    if (!v) throw new Error("La désignation ne peut pas être vide.");
    data.designation = v;
  }
  if (formData.has("categorie")) data.categorie = String(formData.get("categorie") ?? "").trim() || null;
  let changementUnite: { avant: string | null; apres: string | null } | null = null;
  if (formData.has("unite")) {
    const apres = String(formData.get("unite") ?? "").trim() || null;
    const article = await prisma.articleResto.findUnique({ where: { id }, select: { designation: true, unite: true, liens: { select: { articleStockId: true } } } });
    if (!article) throw new Error("Article du restaurant introuvable. Rechargez la page.");
    if (apres !== article.unite) {
      // Seule une AUTRE unité réinterprète l'historique : « Kg » → « kg », « Litres » → « l » (même unité,
      // orthographe corrigée, normalisation unique de la conversion) reste permis, et journalisé.
      if (article.unite !== null && normaliserUnite(apres ?? "") !== normaliserUnite(article.unite)) {
        const [comptages, livraisons] = await Promise.all([
          prisma.comptageResto.count({ where: { articleRestoId: id } }),
          article.liens.length === 0 ? 0 : prisma.mouvementStock.count({ where: { articleId: { in: article.liens.map((l) => l.articleStockId) }, type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT } }),
        ]);
        if (comptages > 0 || livraisons > 0) {
          const quoi = [comptages > 0 ? `${comptages} comptage(s)` : null, livraisons > 0 ? `${livraisons} livraison(s) du dépôt` : null].filter(Boolean).join(" et ");
          throw new Error(
            `L'unité de « ${article.designation} » ne peut plus changer : ${quoi} existent déjà en « ${article.unite} », et les relire dans une autre unité fausserait tout l'historique (par exemple, 4,5 kg deviendrait 4,5 g). ` +
            "Créez un nouvel article avec la bonne unité, puis demandez à la Direction de désactiver celui-ci.",
          );
        }
      }
      changementUnite = { avant: article.unite, apres };
    }
    data.unite = apres;
  }
  if (formData.has("stockBaseJournalier")) data.stockBaseJournalier = decSaisiOptionnel(formData.get("stockBaseJournalier"), "stock de base");
  if (formData.has("ordre")) { const n = Number(formData.get("ordre")); if (Number.isFinite(n)) data.ordre = Math.trunc(n); }
  await prisma.$transaction(async (tx) => {
    await tx.articleResto.update({ where: { id }, data });
    if (changementUnite) {
      await journaliser(tx, { entite: "ArticleResto", entiteId: id, champ: "unite", ancienneValeur: changementUnite.avant, nouvelleValeur: changementUnite.apres, userId: user.id });
    }
  });
  revalidatePath("/stock/restaurant");
});

/** Supprime un article du stock restaurant (et ses comptages). */
export const supprimerArticleResto = actionLisible(async (id: string) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer
  await prisma.articleResto.delete({ where: { id } });
  revalidatePath("/stock/restaurant");
});

/**
 * Désactive (ou réactive) des articles du stock restaurant, à l'unité ou en lot. Un article
 * désactivé disparaît des saisies (comptage, fiches d'inventaire, stock théorique) mais garde tout
 * son historique (comptages) ; il se réactive à l'identique. Mêmes droits que la suppression.
 */
export const changerActivationArticlesResto = actionLisible(async (ids: string[], actif: boolean, confirmer = false) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // Direction, comme la suppression
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("Aucun article sélectionné.");
  const articles = await prisma.articleResto.findMany({ where: { id: { in: ids }, actif: !actif }, select: { id: true, designation: true } });
  if (articles.length === 0) return { ok: true as const, modifies: 0 };
  // Désactiver un article qui a encore du stock compté le retirerait EN SILENCE de la disponibilité
  // des plats : rien n'est écrit, la Direction confirme en connaissant le stock et la conséquence.
  if (!actif && confirmer !== true) {
    const restes = await stocksComptesResto({ id: { in: articles.map((a) => a.id) } });
    if (restes.length > 0) return { ok: false as const, aConfirmer: true as const, message: messageDesactivation(restes) };
  }
  await prisma.$transaction(async (tx) => {
    await tx.articleResto.updateMany({ where: { id: { in: articles.map((a) => a.id) } }, data: { actif } });
    await journaliserPlusieurs(tx, articles.map((a) => ({
      entite: "ArticleResto", entiteId: a.id, champ: "actif",
      ancienneValeur: actif ? "désactivé" : "actif", nouvelleValeur: `${actif ? "actif" : "désactivé"} (${a.designation})`, userId: user.id,
    })));
  });
  revalidatePath("/stock/restaurant");
  return { ok: true as const, modifies: articles.length };
});

// ─── Rattachement au catalogue (disponibilité des plats) ─────────────────────
// Un article du restaurant peut être rattaché à PLUSIEURS articles du catalogue (plusieurs marques de
// beurre) : table de liaison `ArticleRestoStock`. Un rattachement n'est jamais DEVINÉ : soit un geste
// (choix d'articles, propositions cochées), soit le rattachement AUTOMATIQUE des livraisons
// (lib/rattachement-auto.ts), dont la règle exige un seul candidat. Chaque ajout ou retrait de lien est
// journalisé (le libellé de l'article du catalogue, avant → après). Mêmes droits qu'avant : l'espace Stock.

const revaliderRattachement = () => {
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/fiches");
};

const MAX_LIENS_PAR_GESTE = 50;
const idsDistincts = (ids: unknown): string[] => (Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))] : []);

/**
 * Rattache un article du restaurant à un ou PLUSIEURS articles ACTIFS du catalogue (lot). Un couple déjà
 * rattaché est ignoré. Refusé, nommément et sans rien écrire : un article du catalogue déjà rattaché à un
 * AUTRE article du restaurant du MÊME espace (ses livraisons seraient « à répartir » entre les deux) —
 * Cuisine et Bar peuvent chacun avoir le leur, l'espace se lit au domaine de l'article.
 * DIRECTION : écrit tout de suite. Autre compte : dépose une DEMANDE À VALIDER (rien n'est rattaché avant).
 */
export const ajouterLiensResto = actionLisible(async (articleRestoId: string, articleStockIds: string[]) => {
  const user = await garde();
  const ids = idsDistincts(articleStockIds);
  if (ids.length === 0) return { erreur: "Choisissez au moins un article du catalogue." };
  if (ids.length > MAX_LIENS_PAR_GESTE) return { erreur: `Trop d'articles d'un coup (${ids.length}) : ${MAX_LIENS_PAR_GESTE} au plus.` };
  const resto = await prisma.articleResto.findUnique({ where: { id: articleRestoId }, select: { id: true, espace: true, designation: true, liens: { select: { articleStockId: true } } } });
  if (!resto) return { erreur: "Article du restaurant introuvable : rechargez la page." };
  const articles = await prisma.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true, designation: true, contenance: true, contenanceUnite: true, actif: true } });
  if (articles.length !== ids.length) return { erreur: "Article du catalogue introuvable : rechargez la page." };
  const inactif = articles.find((a) => !a.actif);
  if (inactif) return { erreur: `« ${libelleArticle(inactif)} » est désactivé au catalogue : choisissez un article actif.` };
  const dejaLies = new Set(resto.liens.map((l) => l.articleStockId));
  const operations: OperationLien[] = articles.filter((a) => !dejaLies.has(a.id)).map((a) => ({
    op: "AJOUT", articleRestoId: resto.id, articleRestoDesignation: resto.designation, espace: resto.espace, articleStockId: a.id, articleStockDesignation: libelleArticle(a),
  }));
  if (operations.length === 0) return { n: 0 };
  const obstacles = await obstaclesLiens(prisma, operations);
  if (obstacles.length > 0) return { erreur: `${obstacles.join(" ; ")}. Rien n'a été rattaché.` };
  if (!estDirection(user)) {
    await demanderLiensResto(user, operations);
    revaliderRattachement();
    return { n: 0, enAttente: operations.length };
  }
  await prisma.$transaction((tx) => poserLiensTx(tx, user.id, operations));
  revaliderRattachement();
  return { n: operations.length };
});

/**
 * Détache d'un article du restaurant un ou PLUSIEURS articles du catalogue (lot). Un lien absent est ignoré.
 * DIRECTION : retire tout de suite. Autre compte : DEMANDE À VALIDER (le lien reste, « retrait en attente »).
 */
export const retirerLiensResto = actionLisible(async (articleRestoId: string, articleStockIds: string[]) => {
  const user = await garde();
  const ids = idsDistincts(articleStockIds);
  if (ids.length === 0) return { erreur: "Choisissez au moins un article à détacher." };
  const liens = await prisma.articleRestoStock.findMany({
    where: { articleRestoId, articleStockId: { in: ids } },
    select: { articleStockId: true, articleStock: { select: { designation: true, contenance: true, contenanceUnite: true } }, articleResto: { select: { designation: true, espace: true } } },
  });
  if (liens.length === 0) return { n: 0 };
  const operations: OperationLien[] = liens.map((l) => ({
    op: "RETRAIT", articleRestoId, articleRestoDesignation: l.articleResto.designation, espace: l.articleResto.espace, articleStockId: l.articleStockId, articleStockDesignation: libelleArticle(l.articleStock),
  }));
  if (!estDirection(user)) {
    await demanderLiensResto(user, operations);
    revaliderRattachement();
    return { n: 0, enAttente: operations.length };
  }
  exigerDirectionPourSupprimer(user); // défense en profondeur : seule la Direction retire un lien en direct
  await prisma.$transaction((tx) => retirerLiensTx(tx, user.id, operations));
  revaliderRattachement();
  return { n: operations.length };
});

/**
 * Accepte les propositions COCHÉES. Le serveur recalcule les propositions sur les seules lignes
 * reçues : une ligne déjà rattachée entre-temps, renommée, ou dont le nom n'est plus unique au
 * catalogue n'est pas écrite. N'écrit jamais au-delà des cases cochées. Direction : écrit ; autre
 * compte : une demande à valider pour les propositions cochées.
 */
export const accepterPropositions = actionLisible(async (articleRestoIds: string[]) => {
  const user = await garde();
  if (articleRestoIds.length === 0) return { erreur: "Cochez au moins une proposition." };
  const [restos, catalogue] = await Promise.all([
    prisma.articleResto.findMany({ where: { id: { in: articleRestoIds }, actif: true }, select: { id: true, designation: true, unite: true, espace: true, liens: { select: { articleStockId: true } } } }),
    prisma.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, nomCourt: true, actif: true, unite: true, contenance: true, contenanceUnite: true } }),
  ]);
  const propositions = proposerRattachements(restos.map((r) => ({ id: r.id, designation: r.designation, unite: r.unite, articleStockIds: r.liens.map((l) => l.articleStockId) })), catalogue);
  if (propositions.length === 0) {
    return { erreur: "Aucune des lignes cochées n'est encore une proposition valable (déjà rattachée ou renommée). Rechargez la page." };
  }
  const espace = new Map(restos.map((r) => [r.id, r.espace]));
  const operations: OperationLien[] = propositions.map((p) => ({
    op: "AJOUT", articleRestoId: p.articleRestoId, articleRestoDesignation: p.designationResto, espace: espace.get(p.articleRestoId)!, articleStockId: p.articleStockId, articleStockDesignation: p.designationCatalogue,
  }));
  if (!estDirection(user)) {
    // Une demande par ligne qui a un obstacle ne passerait pas : les obstacles sont dits, rien n'est demandé.
    await demanderLiensResto(user, operations);
    revaliderRattachement();
    return { n: 0, enAttente: operations.length, ignores: articleRestoIds.length - operations.length };
  }
  const ecrites: OperationLien[] = [];
  await prisma.$transaction(async (tx) => {
    for (const o of operations) {
      // Garde « encore libre » relue dans la transaction : un rattachement posé entre-temps n'est pas doublé.
      if ((await tx.articleRestoStock.count({ where: { articleRestoId: o.articleRestoId } })) > 0) continue;
      ecrites.push(o);
    }
    await poserLiensTx(tx, user.id, ecrites);
  });
  revaliderRattachement();
  return { n: ecrites.length, ignores: articleRestoIds.length - ecrites.length };
});

/**
 * « Rattacher automatiquement (N) » du bandeau des livraisons : applique EN LOT la règle du
 * rattachement automatique (lib/fiches/rattachement-resto.ts → planifierRattachementsAuto) aux
 * articles du catalogue livrés et non rattachés de la semaine. Mêmes droits que le rattachement à la
 * main (compte Stock) ; un compte non-Direction notifie la Direction. Le serveur recalcule tout : un
 * id jamais livré au restaurant est ignoré, une ligne devenue ambiguë entre-temps est laissée.
 */
export const rattacherLivraisonsAutomatiquement = actionLisible(async (articleStockIds: string[]) => {
  const user = await garde();
  if (!Array.isArray(articleStockIds) || articleStockIds.length === 0) return { erreur: "Aucune livraison à rattacher." };
  if (articleStockIds.length > MAX_RATTACHEMENT_AUTO) return { erreur: `Trop d'articles d'un coup (${articleStockIds.length}) : ${MAX_RATTACHEMENT_AUTO} au plus, décochez-en.` };
  const cr = await rattacherAutomatiquement(user, articleStockIds.map(String), "BOUTON");
  if (cr.erreur) return { erreur: cr.erreur };
  revaliderRattachement();
  return cr;
});
