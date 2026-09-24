import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Stock qui fait foi pour la disponibilité : dépôt + DERNIER comptage des articles du restaurant
// rattachés. Base Postgres éphémère, jamais la production.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { chargerStocksDesFiches } = await import("./charger-fiche");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);

afterAll(async () => { await fermer?.(); });

const article = (designation: string, unite: string) =>
  prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite } });
const resto = (designation: string, unite: string, articleStockId: string | null, actif = true) =>
  prisma.articleResto.create({ data: { espace: "CUISINE", designation, unite, articleStockId, actif } });
const compter = (articleRestoId: string, date: string, quantite: string) =>
  prisma.comptageResto.create({ data: { articleRestoId, date: new Date(date), quantite } });

describe("chargerStocksDesFiches", () => {
  it("dépôt seul, dernier comptage seul, plusieurs articles rattachés, non rattaché ignoré", async () => {
    const farine = await article("Farine", "kg");
    const creme = await article("Crème", "l");
    const sel = await article("Sel", "kg");
    await prisma.stock.create({ data: { articleId: farine.id, quantite: "4" } });
    await prisma.stock.create({ data: { articleId: sel.id, quantite: "1.5" } });

    // Farine : deux articles du restaurant rattachés ; seul le DERNIER comptage de chacun compte.
    const f1 = await resto("Farine cuisine", "g", farine.id);
    await compter(f1.id, "2026-09-20", "9000"); // ancien : ignoré
    await compter(f1.id, "2026-09-22", "1500");
    const f2 = await resto("Farine pâtisserie", "kg", farine.id);
    await compter(f2.id, "2026-09-21", "2");
    // Crème : rattachée, sans ligne Stock.
    const c1 = await resto("Crème", "cl", creme.id);
    await compter(c1.id, "2026-09-22", "50");
    // Non rattaché, et rattaché mais inactif : ignorés.
    const libre = await resto("Farine", "kg", null);
    await compter(libre.id, "2026-09-23", "100");
    const inactif = await resto("Sel (ancien)", "kg", sel.id, false);
    await compter(inactif.id, "2026-09-23", "100");

    // Mouvements au dépôt (tous types, ajustement d'inventaire compris) : seul le plus RÉCENT compte.
    const bouger = (articleId: string, type: "ENTREE" | "SORTIE" | "AJUSTEMENT", date: string) =>
      prisma.mouvementStock.create({ data: { articleId, type, quantite: "1", date: new Date(date) } });
    await bouger(farine.id, "ENTREE", "2026-07-10");
    await bouger(farine.id, "AJUSTEMENT", "2026-09-20");
    await bouger(farine.id, "SORTIE", "2026-08-01");
    // Crème et Sel : jamais mouvementés.

    const groupBy = vi.spyOn(prisma.mouvementStock, "groupBy");
    const findMany = vi.spyOn(prisma.mouvementStock, "findMany");
    const stocks = await chargerStocksDesFiches();

    expect(stocks[farine.id]).toEqual({ depot: "4", restaurant: { etat: "OK", quantite: "3.5", dateComptage: "2026-09-21" }, dernierMouvement: "2026-09-20" });
    expect(stocks[creme.id]).toEqual({ depot: null, restaurant: { etat: "OK", quantite: "0.5", dateComptage: "2026-09-22" }, dernierMouvement: null });
    expect(stocks[sel.id]).toEqual({ depot: "1.5", restaurant: null, dernierMouvement: null });
    // UNE requête groupée pour tous les articles, jamais une requête par article.
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    groupBy.mockRestore(); findMany.mockRestore();
  }, 60_000);
});
