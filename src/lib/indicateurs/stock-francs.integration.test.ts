import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère) : valeur du stock, consommation et inventaire de clôture
// avec un article au prix en FRANCS (2026-10-08). Les articles en dollars gardent EXACTEMENT leurs
// chiffres ; l'article en francs est converti au taux du jour et annoncé « ≈ » ; sans taux, il n'est
// pas valorisé (et c'est dit), jamais compté 0 en silence.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { indicateursStock } = await import("./stock");
const { inventaireActuel } = await import("@/lib/cloture-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const auj = new Date("2026-09-30T00:00:00Z");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  const creer = async (designation: string, prix: { usd?: string; cdf?: string }, quantite: string) => {
    const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", devisePrix: prix.cdf ? "CDF" : "USD", prixUnitaireUSD: prix.usd ?? null, prixUnitaireCDF: prix.cdf ?? null } });
    await prisma.stock.create({ data: { articleId: a.id, quantite, stockMinimum: "0" } });
    return a;
  };
  // Dollars : 10 × 2,50 + 3 × 4,00 = 37,00 (les chiffres de l'accueil d'avant). Francs : 4 × 7 000 FC = 28 000 FC = 10,00 $ à 2 800.
  const farine = await creer("Farine", { usd: "2.5" }, "10");
  await creer("Sel", { usd: "4" }, "3");
  const manioc = await creer("Manioc", { cdf: "7000" }, "4");
  // Conso : farine 2 × 2,50 = 5,00 ; manioc 2 × 7 000 FC ÷ 2 800 = 5,00.
  await prisma.mouvementStock.create({ data: { articleId: farine.id, type: "SORTIE", quantite: 2, date: auj } });
  await prisma.mouvementStock.create({ data: { articleId: manioc.id, type: "SORTIE", quantite: 2, date: auj } });
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

describe("article en francs dans les indicateurs du Stock", () => {
  it("au taux du jour : valeur 37,00 $ (dollars, inchangés) + 10,00 $ (≈ francs) ; conso 5 + 5", async () => {
    const ind = await indicateursStock(new Date("2026-09-30T12:00:00Z"));
    expect(ind.valeurStock).toBeCloseTo(47, 6);
    expect(ind.valeurStockApprox).toBe(true);
    expect(ind.articlesSansTaux).toBe(0);
    expect(ind.consoMois.montant).toBeCloseTo(10, 6);
  }, 60_000);

  it("inventaire de clôture : le franc converti au taux du jour, tracé (prix saisi + taux)", async () => {
    const inv = await inventaireActuel();
    expect(inv.valeurTotaleUSD).toBe(47);
    expect(inv.lignes.find((l) => l.designation === "Manioc")).toMatchObject({ prixUnitaireUSD: 2.5, prixUnitaireCDF: 7000, tauxChange: 2800 });
    expect(inv.lignes.find((l) => l.designation === "Farine")).not.toHaveProperty("prixUnitaireCDF");
  }, 60_000);

  it("sans taux : les dollars restent 37,00 $, l'article en francs n'est pas valorisé et c'est dit", async () => {
    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 0 } });
    const ind = await indicateursStock(new Date("2026-09-30T12:00:00Z"));
    expect(ind.valeurStock).toBeCloseTo(37, 6);
    expect(ind.valeurStockApprox).toBe(false);
    expect(ind.articlesSansTaux).toBe(1);
    expect(ind.consoMois.montant).toBeCloseTo(5, 6); // la sortie en francs n'est pas comptée 0 : elle n'est pas valorisée
    const inv = await inventaireActuel();
    expect(inv.lignes.find((l) => l.designation === "Manioc")).toMatchObject({ prixUnitaireUSD: 0, prixUnitaireCDF: 7000, tauxChange: null });
    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2800 } });
  }, 60_000);
});
