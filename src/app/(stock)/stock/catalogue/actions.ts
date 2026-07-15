"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import type { Prisma } from "@prisma/client";

const dec = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Crée un article dans l'inventaire (+ sa ligne de stock). */
export const creerArticle = actionLisible(async (formData: FormData) => {
  const user = await garde();
  const designation = String(formData.get("designation") ?? "").trim();
  const domaineRaw = String(formData.get("domaine") ?? "");
  if (!designation) throw new Error("La désignation est requise.");
  const domaine = domaineRaw === "NOURRITURE" || domaineRaw === "BOISSON" || domaineRaw === "AUTRE" ? domaineRaw : "NOURRITURE";
  const categorieId = String(formData.get("categorieId") ?? "").trim() || null;
  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;

  const art = await prisma.articleStock.create({
    data: {
      designation,
      domaine,
      code: String(formData.get("code") ?? "").trim() || null,
      unite: String(formData.get("unite") ?? "").trim() || null,
      categorieId,
      fournisseurId,
      prixUnitaireUSD: dec(formData.get("prixUnitaireUSD")),
      uniteParCarton: dec(formData.get("uniteParCarton")),
      stock: {
        create: {
          quantite: dec(formData.get("quantite")) ?? 0,
          stockMinimum: dec(formData.get("stockMinimum")) ?? 0,
          seuilUrgent: dec(formData.get("seuilUrgent")) ?? 0,
        },
      },
    },
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: art.id, champ: "creation", nouvelleValeur: designation, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Modifie un ou plusieurs champs d'un article (et ses seuils/stock). */
export const modifierArticle = actionLisible(async (id: string, formData: FormData) => {
  const user = await garde();
  const data: Prisma.ArticleStockUpdateInput = {};
  if (formData.has("code")) data.code = String(formData.get("code") ?? "").trim() || null;
  if (formData.has("designation")) data.designation = String(formData.get("designation")).trim();
  if (formData.has("prixUnitaireUSD")) data.prixUnitaireUSD = dec(formData.get("prixUnitaireUSD"));
  if (formData.has("uniteParCarton")) data.uniteParCarton = dec(formData.get("uniteParCarton"));
  if (formData.has("unite")) data.unite = String(formData.get("unite")).trim() || null;
  if (formData.has("categorieId")) {
    const c = String(formData.get("categorieId")).trim();
    data.categorie = c ? { connect: { id: c } } : { disconnect: true };
  }
  if (formData.has("fournisseurId")) {
    const f = String(formData.get("fournisseurId")).trim();
    data.fournisseur = f ? { connect: { id: f } } : { disconnect: true };
  }
  await prisma.articleStock.update({ where: { id }, data });

  // seuils / stock (modèle Stock lié)
  const stockData: Prisma.StockUpdateInput = {};
  if (formData.has("stockMinimum")) stockData.stockMinimum = dec(formData.get("stockMinimum")) ?? 0;
  if (formData.has("seuilUrgent")) stockData.seuilUrgent = dec(formData.get("seuilUrgent")) ?? 0;
  if (formData.has("quantite")) stockData.quantite = dec(formData.get("quantite")) ?? 0;
  if (Object.keys(stockData).length > 0) {
    await prisma.stock.upsert({
      where: { articleId: id },
      update: stockData,
      create: {
        articleId: id,
        quantite: dec(formData.get("quantite")) ?? 0,
        stockMinimum: dec(formData.get("stockMinimum")) ?? 0,
        seuilUrgent: dec(formData.get("seuilUrgent")) ?? 0,
      },
    });
  }
  await journaliser(prisma, { entite: "ArticleStock", entiteId: id, champ: "modification", userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Fusionne plusieurs articles en un seul (pour les doublons sémantiques : crème fraîche = cooking
 * cream…). Garde le premier ; réaffecte mouvements et lignes de BC, cumule le stock, supprime les autres. */
/**
 * Fusionne plusieurs articles en un seul. `keepId` = article à CONSERVER (choisi par l'utilisateur) ;
 * s'il est absent/invalide, on garde par défaut celui qui a une catégorie, sinon le plus fourni.
 * Les mouvements, lignes de BC et lignes de facture des doublons sont rattachés à l'article conservé,
 * leur stock cumulé, puis ils sont supprimés.
 */
export const fusionnerArticles = actionLisible(async (articleIds: string[], keepId?: string) => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length < 2) throw new Error("Sélectionnez au moins deux articles à fusionner.");
  const arts = await prisma.articleStock.findMany({ where: { id: { in: ids } }, include: { stock: true } });
  if (arts.length < 2) return;

  // Choix explicite de l'utilisateur, sinon repli : catégorie d'abord, puis stock le plus fourni.
  const keep = (keepId ? arts.find((a) => a.id === keepId) : undefined)
    ?? [...arts].sort((a, b) => (b.categorieId ? 1 : 0) - (a.categorieId ? 1 : 0) || Number(b.stock?.quantite ?? 0) - Number(a.stock?.quantite ?? 0))[0];
  const losers = arts.filter((a) => a.id !== keep.id);
  if (losers.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const l of losers) {
      await tx.mouvementStock.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      await tx.ligneBonDeCommande.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      await tx.ligneFacture.updateMany({ where: { articleId: l.id }, data: { articleId: keep.id } });
      if (l.stock) await tx.stock.update({ where: { articleId: keep.id }, data: { quantite: { increment: Number(l.stock.quantite) } } });
      await tx.articleStock.delete({ where: { id: l.id } });
    }
  });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: keep.id, champ: "fusion", nouvelleValeur: `${losers.length} doublon(s) fusionné(s) → ${keep.designation}`, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Catégorise en masse : affecte une catégorie à plusieurs articles. */
export const categoriserEnMasse = actionLisible(async (articleIds: string[], categorieId: string) => {
  const user = await garde();
  if (articleIds.length === 0 || !categorieId) return;
  await prisma.articleStock.updateMany({ where: { id: { in: articleIds } }, data: { categorieId } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: `${articleIds.length} articles`, champ: "categorie (masse)", nouvelleValeur: categorieId, userId: user.id });
  revalidatePath("/stock/catalogue");
});

/** Active ou désactive plusieurs articles d'un coup. */
export const basculerActifArticles = actionLisible(async (articleIds: string[], actif: boolean) => {
  const user = await garde();
  const uniq = [...new Set(articleIds.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const n = await prisma.articleStock.updateMany({ where: { id: { in: uniq } }, data: { actif } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: "lot", champ: "actif", nouvelleValeur: `${n.count} article(s) ${actif ? "activé(s)" : "désactivé(s)"}`, userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
});

/** Affecte un fournisseur (ou le retire si vide) à plusieurs articles d'un coup. */
export const definirFournisseurEnMasse = actionLisible(async (articleIds: string[], fournisseurId: string) => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length === 0) return;
  await prisma.articleStock.updateMany({ where: { id: { in: ids } }, data: { fournisseurId: fournisseurId || null } });
  await journaliser(prisma, { entite: "ArticleStock", entiteId: `${ids.length} articles`, champ: "fournisseur (masse)", nouvelleValeur: fournisseurId || "retiré", userId: user.id });
  revalidatePath("/stock/catalogue");
});

/**
 * Corrige les stocks négatifs des articles donnés en les remettant à 0. Un stock négatif traduit
 * plus de sorties que d'entrées enregistrées : on le comble par un mouvement d'ENTRÉE d'ajustement
 * (traçable), daté du jour, plutôt qu'en écrasant silencieusement la quantité.
 */
export const corrigerStocksNegatifs = actionLisible(async (articleIds: string[]) => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  if (ids.length === 0) return { corriges: 0 };
  const stocks = await prisma.stock.findMany({ where: { articleId: { in: ids }, quantite: { lt: 0 } } });
  if (stocks.length === 0) return { corriges: 0 };
  const date = new Date();
  await exigerPeriodeOuverte(date);
  await prisma.$transaction(async (tx) => {
    for (const s of stocks) {
      const manque = -Number(s.quantite); // quantité positive à réinjecter pour revenir à 0
      await tx.mouvementStock.create({ data: { articleId: s.articleId, type: "ENTREE", quantite: manque, origine: "Correction stock négatif (mise à 0)", date, creeParId: user.id } });
      await tx.stock.update({ where: { articleId: s.articleId }, data: { quantite: 0 } });
    }
  }, { timeout: 60000 });
  await journaliser(prisma, { entite: "Stock", entiteId: `${stocks.length} articles`, champ: "correction stock négatif", nouvelleValeur: "remis à 0 (ajustement)", userId: user.id });
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  return { corriges: stocks.length };
});

/** Définit le stock minimum (seuil d'alerte de réappro) de plusieurs articles d'un coup. */
export const definirSeuilEnMasse = actionLisible(async (articleIds: string[], seuil: number) => {
  const user = await garde();
  const ids = [...new Set(articleIds.map(String))].filter(Boolean);
  const s = Math.max(0, Number(seuil) || 0);
  if (ids.length === 0) return;
  // Le seuil vit sur la ligne Stock (créée si absente).
  await prisma.$transaction(async (tx) => {
    for (const articleId of ids) {
      await tx.stock.upsert({ where: { articleId }, update: { stockMinimum: s }, create: { articleId, quantite: 0, stockMinimum: s } });
    }
  }, { timeout: 60000 });
  await journaliser(prisma, { entite: "Stock", entiteId: `${ids.length} articles`, champ: "stockMinimum (masse)", nouvelleValeur: String(s), userId: user.id });
  revalidatePath("/stock/catalogue");
});
