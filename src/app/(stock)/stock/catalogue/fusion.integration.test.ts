import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Fusion d'articles : l'article CHOISI est conservé (pas l'heuristique), stock cumulé, mouvements
// et lignes de facture rattachés, doublons supprimés.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { fusionnerArticles } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("fusionnerArticles — choix de l'article à conserver", () => {
  it("conserve l'article CHOISI (même sans catégorie), cumule le stock et rattache les mouvements", async () => {
    // « garder » n'a pas de catégorie et moins de stock → l'heuristique aurait choisi l'autre.
    const garder = await prisma.articleStock.create({ data: { designation: "Spaghetti (à garder)", domaine: "NOURRITURE" } });
    const cat = await prisma.categorieStock.create({ data: { nom: "Pâtes", domaine: "NOURRITURE" } });
    const doublon = await prisma.articleStock.create({ data: { designation: "Spaghettis", domaine: "NOURRITURE", categorieId: cat.id } });
    await prisma.stock.create({ data: { articleId: garder.id, quantite: 3 } });
    await prisma.stock.create({ data: { articleId: doublon.id, quantite: 10 } });
    await prisma.mouvementStock.create({ data: { articleId: doublon.id, type: "ENTREE", quantite: 10 } });

    await fusionnerArticles([garder.id, doublon.id], garder.id);

    // Le doublon est supprimé, l'article choisi conservé.
    expect(await prisma.articleStock.findUnique({ where: { id: doublon.id } })).toBeNull();
    const restant = await prisma.articleStock.findUnique({ where: { id: garder.id }, include: { stock: true } });
    expect(restant).not.toBeNull();
    expect(restant!.designation).toBe("Spaghetti (à garder)");
    expect(Number(restant!.stock!.quantite)).toBe(13); // 3 + 10 cumulés
    // Le mouvement du doublon est rattaché à l'article conservé.
    const mvts = await prisma.mouvementStock.findMany({ where: { articleId: garder.id } });
    expect(mvts).toHaveLength(1);
  }, 60_000);

  it("rattache aussi les ingrédients de FICHE TECHNIQUE (sinon la fusion échoue en bloc)", async () => {
    // `IngredientFiche.articleId` est en `onDelete: Restrict` : sans rebranchement, supprimer le
    // doublon violait la contrainte et annulait TOUTE la transaction — or la fusion est justement
    // le remède aux doublons signalés par l'import (« CAILLES » / « Cailles »).
    const garder = await prisma.articleStock.create({ data: { designation: "Cailles", domaine: "NOURRITURE", unite: "pièce" } });
    const doublon = await prisma.articleStock.create({ data: { designation: "CAILLES", domaine: "NOURRITURE", unite: "pièce" } });
    const fiche = await prisma.ficheTechnique.create({ data: { nom: "Cailles rôties", nbPortions: 2 } });
    await prisma.ingredientFiche.create({ data: { ficheId: fiche.id, articleId: doublon.id, unite: "pièce", quantite: 2 } });

    await fusionnerArticles([garder.id, doublon.id], garder.id);

    expect(await prisma.articleStock.findUnique({ where: { id: doublon.id } })).toBeNull();
    // La recette n'a pas perdu sa ligne : elle pointe désormais l'article conservé.
    const lignes = await prisma.ingredientFiche.findMany({ where: { ficheId: fiche.id } });
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.articleId).toBe(garder.id);
    expect(Number(lignes[0]!.quantite)).toBe(2); // quantité intacte
  }, 60_000);
});
