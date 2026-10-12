import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";
import { jourKinshasaISO } from "@/lib/date-paiement";

/**
 * Un article du restaurant rattaché à PLUSIEURS articles du catalogue (plusieurs marques de beurre),
 * sur une VRAIE base : lecture des liens (livraisons de chaque marque), disponibilité des plats (dépôt
 * des marques sommé, un négatif annoncé), désactivation, et la recopie des liens existants par la
 * migration.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, user: { id: "", role: "ADMIN" as Role, accesStock: false, nom: "Direction" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => H.user,
  requireModule: (u: { role: Role; accesStock?: boolean }, espace: string) => {
    if (espace !== "stock" || !estStock(u)) throw new Error("Accès refusé : module non autorisé.");
  },
  requireRole: (u: { role: Role }, roles: Role[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { retirerLiensResto, changerActivationArticlesResto } = await import("./actions");
const { chargerEntreesStockResto } = await import("@/lib/stock-restaurant-charger");
const { stockRestaurantTheorique } = await import("@/lib/stock-restaurant");
const { chargerFichesVues, chargerArticlesDesFiches, chargerStocksDesFiches } = await import("../fiches/_data/charger-fiche");
const { disponibilitesDesFiches, resumerDispo } = await import("../fiches/_data/fiche-calc");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids: Record<string, string> = {};
const AUJ = jourKinshasaISO();
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const jourAvant = (n: number) => { const d = le(AUJ); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const ok = (r: unknown) => { if (typeof r === "object" && r !== null && "erreur" in r) throw new Error(String((r as { erreur: string }).erreur)); };

async function dispoDuPlat() {
  const [vues, articles, stocks] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches(), chargerStocksDesFiches(AUJ)]);
  const vue = vues.find((v) => v.id === ids.plat)!;
  return resumerDispo(disponibilitesDesFiches(vues, articles, stocks, AUJ).get(ids.plat)!, vue);
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  ids.dir = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  H.user = { id: ids.dir, role: "ADMIN", accesStock: false, nom: "Direction" };
  const marque = (designation: string, g: number) => prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Pièce", contenance: g, contenanceUnite: "g" } });
  ids.president = (await marque("Beurre Président", 250)).id;
  ids.lurpak = (await marque("Beurre Lurpak", 500)).id;
  ids.resto = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Beurre", unite: "kg", ordre: 1 } })).id;
  // État d'AVANT la règle « une seule unité par produit » (resto en kg, marques en pièces de 250 g / 500 g) : posé en base,
  // car le geste de rattachement exige désormais la même unité. La lecture des liens, elle, doit continuer de convertir.
  await prisma.articleRestoStock.createMany({ data: [{ articleRestoId: ids.resto, articleStockId: ids.president }, { articleRestoId: ids.resto, articleStockId: ids.lurpak }] });
  // Comptage d'hier : 0,5 kg ; livraisons d'aujourd'hui des DEUX marques : 4 × 250 g + 2 × 500 g = 2 kg.
  await prisma.comptageResto.create({ data: { articleRestoId: ids.resto, date: le(jourAvant(1)), quantite: 0.5 } });
  const sortie = (articleId: string, quantite: number) => prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", quantite, date: le(AUJ) } });
  await sortie(ids.president, 4); await sortie(ids.lurpak, 2);
  // Plat : 250 g de Beurre Président par portion.
  ids.plat = (await prisma.ficheTechnique.create({ data: { nom: "Sauce au beurre", ingredients: { create: [{ articleId: ids.president, unite: "g", quantite: 250, ordre: 1 }] } } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("plusieurs marques pour un article du restaurant (base réelle)", () => {
  it("les livraisons des DEUX marques alimentent le même article : 0,5 kg compté + 1 kg + 1 kg = 2,5 kg, aucun signalement", async () => {
    const e = await chargerEntreesStockResto({ depuis: AUJ, jusquA: AUJ });
    expect(e.articles).toHaveLength(1);
    expect(e.articles[0]!.rattaches.map((l) => l.id).sort()).toEqual([ids.president, ids.lurpak].sort());
    const s = stockRestaurantTheorique(e, AUJ).parArticle.get(ids.resto)!;
    expect(s.signalements).toEqual([]);
    expect(s.stock).toBe("2.5");
  });

  it("disponibilité : dépôt des deux marques SOMMÉ (converti), plus la part du restaurant ; un dépôt négatif sur une marque : « À vérifier »", async () => {
    await prisma.stock.create({ data: { articleId: ids.president, quantite: 3 } });
    await prisma.stock.create({ data: { articleId: ids.lurpak, quantite: 2 } });
    await prisma.mouvementStock.create({ data: { articleId: ids.president, type: "ENTREE", quantite: 3, date: le(jourAvant(1)) } });
    const d = await dispoDuPlat();
    // Dépôt : 3 pièces de 250 g + 2 pièces de 500 g = 7 pièces de 250 g ; restaurant : 2,5 kg = 10 pièces → 17 portions.
    expect(d.etat).toBe("DISPONIBLE");
    expect(d.portions).toBe(17);
    await prisma.stock.update({ where: { articleId: ids.lurpak }, data: { quantite: -1 } });
    const n = await dispoDuPlat();
    expect(n.etat).toBe("A_VERIFIER");
    expect(n.raisons).toEqual(["Beurre Président 250 g : stock négatif"]);
    await prisma.stock.update({ where: { articleId: ids.lurpak }, data: { quantite: 2 } });
  }, 60_000);

  it("retirer une marque : ses livraisons n'alimentent plus l'article ni le dépôt sommé ; l'autre reste", async () => {
    ok(await retirerLiensResto(ids.resto, [ids.lurpak]));
    const e = await chargerEntreesStockResto({ depuis: AUJ, jusquA: AUJ });
    const r = stockRestaurantTheorique(e, AUJ);
    expect(r.parArticle.get(ids.resto)!.stock).toBe("1.5");
    expect(r.nonRattachees.map((l) => l.articleStockId)).toEqual([ids.lurpak]);
    const d = await dispoDuPlat();
    expect(d.etat).toBe("DISPONIBLE");
    expect(d.portions).toBe(9); // dépôt 3 + restaurant 1,5 kg = 6 pièces
    await prisma.articleRestoStock.create({ data: { articleRestoId: ids.resto, articleStockId: ids.lurpak } });
  }, 60_000);

  it("désactiver l'article avec du stock : TOUTES les marques passent « À vérifier », la confirmation nomme les livraisons de chacune", async () => {
    const r = await changerActivationArticlesResto([ids.resto], false);
    expect(r).toMatchObject({ ok: false, aConfirmer: true });
    // Livraisons depuis le comptage d'hier : chaque marque dans SON unité (4 pièces de 250 g, 2 pièces de 500 g).
    expect((r as { message: string }).message).toMatch(/4 Pièce et 2 Pièce livrés depuis|2 Pièce et 4 Pièce livrés depuis/);
    ok(await changerActivationArticlesResto([ids.resto], false, true));
    const d = await dispoDuPlat();
    expect(d.etat).toBe("A_VERIFIER");
    ok(await changerActivationArticlesResto([ids.resto], true));
  }, 60_000);
});

describe("migration 20261012100000 : les liens existants sont recopiés dans la table de liaison", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20261013110000_article_resto_plusieurs_articles/migration.sql"), "utf8");
  const insertion = sql.slice(sql.indexOf('INSERT INTO "stock"."ArticleRestoStock"')).replace(/;\s*$/, "");

  it("chaque ancien articleStockId devient un lien ; rien pour un article sans lien ; rejouable sans doublon", async () => {
    const a = await prisma.articleStock.create({ data: { designation: "Sel migration", domaine: "NOURRITURE", unite: "kg" } });
    const avecLien = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Sel (ancien lien)", unite: "kg" } });
    const sansLien = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Poivre (aucun lien)", unite: "kg" } });
    // Ancien état : la colonne seule (l'ancien code ne connaît pas la table de liaison).
    await prisma.$executeRawUnsafe(`UPDATE "stock"."ArticleResto" SET "articleStockId" = '${a.id}' WHERE "id" = '${avecLien.id}'`);
    expect(await prisma.articleRestoStock.count({ where: { articleRestoId: { in: [avecLien.id, sansLien.id] } } })).toBe(0);
    expect(insertion).toContain("ON CONFLICT");
    await prisma.$executeRawUnsafe(insertion);
    await prisma.$executeRawUnsafe(insertion); // rejoué (rattrapage après le déploiement) : aucun doublon
    const liens = await prisma.articleRestoStock.findMany({ where: { articleRestoId: { in: [avecLien.id, sansLien.id] } } });
    expect(liens.map((l) => [l.articleRestoId, l.articleStockId])).toEqual([[avecLien.id, a.id]]);
  }, 60_000);
});
