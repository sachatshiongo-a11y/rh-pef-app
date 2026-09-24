"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decOptionnel as dec } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser, journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { proposerRattachements } from "@/lib/fiches/rattachement-resto";


async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Met à jour le comptage d'un article resto pour une date donnée (upsert ; vide = suppression). */
export const majComptage = actionLisible(async (articleRestoId: string, dateISO: string, valeur: string) => {
  await garde();
  const date = new Date(dateISO);
  const q = dec(valeur);
  if (q === null) {
    await prisma.comptageResto.deleteMany({ where: { articleRestoId, date } });
  } else {
    await prisma.comptageResto.upsert({
      where: { articleRestoId_date: { articleRestoId, date } },
      update: { quantite: q },
      create: { articleRestoId, date, quantite: q },
    });
  }
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
      stockBaseJournalier: dec(formData.get("stockBaseJournalier")),
      ordre: (dernier._max.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/stock/restaurant");
});

/** Modifie un champ d'un article resto (désignation, catégorie, unité, base, ordre). */
export const modifierArticleResto = actionLisible(async (id: string, formData: FormData) => {
  await garde();
  const data: Record<string, unknown> = {};
  if (formData.has("designation")) {
    const v = String(formData.get("designation") ?? "").trim();
    if (!v) throw new Error("La désignation ne peut pas être vide.");
    data.designation = v;
  }
  if (formData.has("categorie")) data.categorie = String(formData.get("categorie") ?? "").trim() || null;
  if (formData.has("unite")) data.unite = String(formData.get("unite") ?? "").trim() || null;
  if (formData.has("stockBaseJournalier")) data.stockBaseJournalier = dec(formData.get("stockBaseJournalier"));
  if (formData.has("ordre")) { const n = Number(formData.get("ordre")); if (Number.isFinite(n)) data.ordre = Math.trunc(n); }
  await prisma.articleResto.update({ where: { id }, data });
  revalidatePath("/stock/restaurant");
});

/** Supprime un article du stock restaurant (et ses comptages). */
export const supprimerArticleResto = actionLisible(async (id: string) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer
  await prisma.articleResto.delete({ where: { id } });
  revalidatePath("/stock/restaurant");
});

// ─── Rattachement au catalogue (disponibilité des plats) ─────────────────────
// Toujours un GESTE de la Direction, jamais une déduction : ces deux actions sont les seules à écrire
// `articleStockId`, et chacune journalise l'avant → après.

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
    prisma.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, actif: true, unite: true } }),
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
