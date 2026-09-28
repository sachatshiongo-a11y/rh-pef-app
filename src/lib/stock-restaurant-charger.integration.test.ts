import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Chargeur du stock théorique du restaurant : requêtes GROUPÉES (jamais une par article), bornes
// des comptages et des livraisons. Base Postgres éphémère, jamais la production.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { chargerEntreesStockResto } = await import("./stock-restaurant-charger");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("chargerEntreesStockResto", () => {
  it("dernier comptage avant la période + comptages de la période ; livraisons depuis le plus ancien de ces comptages", async () => {
    const farine = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg" } });
    const sel = await prisma.articleStock.create({ data: { designation: "Sel", domaine: "NOURRITURE", unite: "kg" } });
    const r = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Farine", unite: "g", articleStockId: farine.id } });
    const inactif = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Ancien", unite: "g", articleStockId: farine.id, actif: false } });
    const compter = (id: string, date: string, q: string) => prisma.comptageResto.create({ data: { articleRestoId: id, date: new Date(date), quantite: q } });
    await compter(r.id, "2026-09-01", "1"); // plus ancien que le dernier avant la période : non chargé
    await compter(r.id, "2026-09-10", "2"); // dernier avant la période
    await compter(r.id, "2026-09-22", "3"); // dans la période
    await compter(r.id, "2026-09-30", "4"); // après la période
    await compter(inactif.id, "2026-09-22", "9");
    const sortie = (articleId: string, date: string, categorieSortie: string | null) =>
      prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite: "1", date: new Date(date), categorieSortie } });
    await sortie(farine.id, "2026-09-05", "LIVRAISON_RESTAURANT"); // avant le dernier comptage : inutile
    await sortie(farine.id, "2026-09-12", "LIVRAISON_RESTAURANT");
    await sortie(farine.id, "2026-09-12", "PERTE");
    await sortie(sel.id, "2026-09-23", "LIVRAISON_RESTAURANT"); // non rattaché : chargé pour être signalé
    await sortie(farine.id, "2026-09-29", "LIVRAISON_RESTAURANT"); // après la période

    const espions = [
      vi.spyOn(prisma.articleResto, "findMany"), vi.spyOn(prisma.comptageResto, "groupBy"),
      vi.spyOn(prisma.comptageResto, "findMany"), vi.spyOn(prisma.mouvementStock, "findMany"),
    ];
    const e = await chargerEntreesStockResto({ depuis: "2026-09-21", jusquA: "2026-09-27" });
    expect(espions.map((s) => s.mock.calls.length)).toEqual([1, 1, 1, 1]);
    espions.forEach((s) => s.mockRestore());

    expect(e.articles).toEqual([{ id: r.id, designation: "Farine", espace: "CUISINE", unite: "g", articleStockId: farine.id, uniteCatalogue: "kg" }]);
    expect(e.comptages.map((c) => [c.date, c.quantite]).sort()).toEqual([["2026-09-10", "2"], ["2026-09-22", "3"]]);
    expect(e.livraisons.map((l) => [l.designation, l.date, l.categorieSortie]).sort()).toEqual([
      ["Farine", "2026-09-12", "LIVRAISON_RESTAURANT"],
      ["Sel", "2026-09-23", "LIVRAISON_RESTAURANT"],
    ]);
  }, 60_000);

  it("un article rattaché jamais compté : seules les livraisons de la période sont chargées (plus tout l'historique)", async () => {
    await prisma.mouvementStock.deleteMany(); await prisma.comptageResto.deleteMany(); await prisma.articleResto.deleteMany();
    const beurre = await prisma.articleStock.create({ data: { designation: "Beurre", domaine: "NOURRITURE", unite: "kg" } });
    await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Beurre", unite: "kg", articleStockId: beurre.id } });
    const livrer = (date: string) => prisma.mouvementStock.create({ data: { articleId: beurre.id, type: "SORTIE", quantite: "1", date: new Date(date), categorieSortie: "LIVRAISON_RESTAURANT" } });
    await livrer("2026-06-01");
    await livrer("2026-09-22");
    const e = await chargerEntreesStockResto({ depuis: "2026-09-21", jusquA: "2026-09-27" });
    expect(e.livraisons.map((l) => l.date)).toEqual(["2026-09-22"]);
    expect(e.debutLivraisons).toBe("2026-09-21");
  }, 60_000);
});
