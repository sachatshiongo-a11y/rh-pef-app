import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { creerBaseTest } from "@/lib/test/db";

describe("schéma fiches techniques", () => {
  let ctx: Awaited<ReturnType<typeof creerBaseTest>>;
  beforeAll(async () => { ctx = await creerBaseTest(); });
  afterAll(async () => { await ctx?.fermer(); });

  it("crée un article, une fiche technique, un ingrédient article et un ingrédient sous-fiche", async () => {
    const { prisma } = ctx;

    const article = await prisma.articleStock.create({
      data: { designation: "Farine de blé", domaine: "NOURRITURE", unite: "Kg" },
    });

    const sauce = await prisma.ficheTechnique.create({
      data: { nom: "Sauce tomate maison", type: "PLAT", estSousRecette: true, rendementQuantite: "1000", rendementUnite: "g" },
    });

    const plat = await prisma.ficheTechnique.create({
      data: { nom: "Spaghetti bolognaise", type: "PLAT", nbPortions: 4 },
    });

    const ingredientArticle = await prisma.ingredientFiche.create({
      data: { ficheId: plat.id, articleId: article.id, unite: "g", quantite: "400" },
    });

    const ingredientSousFiche = await prisma.ingredientFiche.create({
      data: { ficheId: plat.id, sousFicheId: sauce.id, unite: "g", quantite: "300" },
    });

    expect(await prisma.ficheTechnique.count()).toBe(2);

    expect(ingredientArticle.articleId).toBe(article.id);
    expect(ingredientArticle.sousFicheId).toBeNull();

    expect(ingredientSousFiche.sousFicheId).toBe(sauce.id);
    expect(ingredientSousFiche.articleId).toBeNull();
  });

  // Les règles onDelete portent l'intégrité du coût de revient : on ne doit jamais pouvoir faire
  // disparaître un article ou une sous-recette encore référencés (le coût deviendrait faux en silence).
  it("applique RESTRICT sur article/sous-fiche référencés et CASCADE sur la fiche parente", async () => {
    const { prisma } = ctx;

    const article = await prisma.articleStock.create({
      data: { designation: "Huile d'olive", domaine: "NOURRITURE", unite: "L" },
    });
    const sauce = await prisma.ficheTechnique.create({
      data: { nom: "Sauce pesto", estSousRecette: true },
    });
    const plat = await prisma.ficheTechnique.create({ data: { nom: "Pâtes au pesto" } });

    await prisma.ingredientFiche.create({
      data: { ficheId: plat.id, articleId: article.id, unite: "ml", quantite: "20" },
    });
    await prisma.ingredientFiche.create({
      data: { ficheId: plat.id, sousFicheId: sauce.id, unite: "g", quantite: "60" },
    });

    // RESTRICT : l'article et la sous-recette sont encore utilisés → suppression refusée.
    await expect(prisma.articleStock.delete({ where: { id: article.id } })).rejects.toThrow();
    await expect(prisma.ficheTechnique.delete({ where: { id: sauce.id } })).rejects.toThrow();

    // CASCADE : supprimer la fiche parente emporte ses lignes d'ingrédients…
    await prisma.ficheTechnique.delete({ where: { id: plat.id } });
    expect(await prisma.ingredientFiche.count({ where: { ficheId: plat.id } })).toBe(0);

    // …mais ni l'article ni la sous-recette, qui restent au catalogue.
    expect(await prisma.articleStock.count({ where: { id: article.id } })).toBe(1);
    expect(await prisma.ficheTechnique.count({ where: { id: sauce.id } })).toBe(1);
  });
});
