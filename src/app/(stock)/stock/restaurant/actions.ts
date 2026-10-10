"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisiOptionnel } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { proposerRattachements } from "@/lib/fiches/rattachement-resto";
import { messageDesactivation, stocksComptesResto } from "@/lib/stock-restaurant-charger";
import { rattacherAutomatiquement } from "@/lib/rattachement-auto";
import { exigerJourSaisissable, lireJourSaisie } from "@/lib/saisie-restaurant";
import { MOTIF_LIVRAISON_RESTAURANT } from "@/lib/stock-restaurant";

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
    const article = await prisma.articleResto.findUnique({ where: { id }, select: { designation: true, unite: true, articleStockId: true } });
    if (!article) throw new Error("Article du restaurant introuvable. Rechargez la page.");
    if (apres !== article.unite) {
      if (article.unite !== null) {
        const [comptages, livraisons] = await Promise.all([
          prisma.comptageResto.count({ where: { articleRestoId: id } }),
          article.articleStockId === null ? 0 : prisma.mouvementStock.count({ where: { articleId: article.articleStockId, type: "SORTIE", categorieSortie: MOTIF_LIVRAISON_RESTAURANT } }),
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
// Un rattachement n'est jamais DEVINÉ : soit un geste (choix d'un article, propositions cochées), soit
// le rattachement AUTOMATIQUE des livraisons (lib/rattachement-auto.ts), dont la règle exige un seul
// candidat. Chaque écriture de `articleStockId` journalise l'avant → après.

const revaliderRattachement = () => {
  revalidatePath("/stock/restaurant");
  revalidatePath("/stock/fiches");
};

/** Rattache (ou détache, avec `null`) un article du restaurant à un article actif du catalogue. */
export const rattacherArticleResto = actionLisible(async (articleRestoId: string, articleStockId: string | null) => {
  const user = await garde();
  const resto = await prisma.articleResto.findUnique({ where: { id: articleRestoId }, select: { id: true, articleStockId: true } });
  if (!resto) return { erreur: "Article du restaurant introuvable : rechargez la page." };
  if (articleStockId !== null) {
    const article = await prisma.articleStock.findUnique({ where: { id: articleStockId }, select: { actif: true } });
    if (!article) return { erreur: "Article du catalogue introuvable : rechargez la page." };
    if (!article.actif) return { erreur: "Cet article du catalogue est désactivé : choisissez un article actif." };
  }
  if (resto.articleStockId === articleStockId) return { n: 0 };

  await prisma.$transaction(async (tx) => {
    await tx.articleResto.update({ where: { id: resto.id }, data: { articleStockId } });
    await journaliser(tx, {
      entite: "ArticleResto", entiteId: resto.id, champ: "articleStockId",
      ancienneValeur: resto.articleStockId, nouvelleValeur: articleStockId, userId: user.id,
    });
  });
  revaliderRattachement();
  return { n: 1 };
});

/**
 * Accepte les propositions COCHÉES. Le serveur recalcule les propositions sur les seules lignes
 * reçues : une ligne déjà rattachée entre-temps, renommée, ou dont le nom n'est plus unique au
 * catalogue n'est pas écrite. N'écrit jamais au-delà des cases cochées.
 */
export const accepterPropositions = actionLisible(async (articleRestoIds: string[]) => {
  const user = await garde();
  if (articleRestoIds.length === 0) return { erreur: "Cochez au moins une proposition." };
  const [restos, catalogue] = await Promise.all([
    prisma.articleResto.findMany({ where: { id: { in: articleRestoIds }, actif: true }, select: { id: true, designation: true, articleStockId: true, unite: true } }),
    prisma.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, nomCourt: true, actif: true, unite: true, contenance: true, contenanceUnite: true } }),
  ]);
  const propositions = proposerRattachements(restos, catalogue);
  if (propositions.length === 0) {
    return { erreur: "Aucune des lignes cochées n'est encore une proposition valable (déjà rattachée ou renommée). Rechargez la page." };
  }

  const entrees: EntreeJournal[] = [];
  await prisma.$transaction(async (tx) => {
    for (const p of propositions) {
      // Garde « encore libre » dans la requête même : un rattachement posé entre-temps n'est pas écrasé.
      const r = await tx.articleResto.updateMany({ where: { id: p.articleRestoId, articleStockId: null }, data: { articleStockId: p.articleStockId } });
      if (r.count === 1) {
        entrees.push({ entite: "ArticleResto", entiteId: p.articleRestoId, champ: "articleStockId", ancienneValeur: null, nouvelleValeur: p.articleStockId, userId: user.id });
      }
    }
    await journaliserPlusieurs(tx, entrees);
  });
  revaliderRattachement();
  return { n: entrees.length, ignores: articleRestoIds.length - entrees.length };
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
