import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Tests d'INTÉGRATION (Postgres éphémère, jamais la prod) : import CSV d'entrées/sorties, son
// annulation réversible, et le refus d'écrire dans un mois clôturé.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { appliquerMouvements } = await import("@/lib/import-mouvements");
const { annulerImport } = await import("@/lib/import-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;
let userId: string;

const CSV = "Date,Code article,Désignation,Entrées,Sorties\n10/07/2026,3,Riz basmati 5kg,5,2";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "Testeur", role: "ADMIN" } });
  userId = u.id;
  const art = await prisma.articleStock.create({ data: { code: "3", designation: "Riz basmati 5kg", domaine: "NOURRITURE", unite: "Sac" } });
  articleId = art.id;
  await prisma.stock.create({ data: { articleId, quantite: 10, stockMinimum: 4 } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("appliquerMouvements — import CSV + annulation réversible", () => {
  it("crée les mouvements (entrée + sortie) et ajuste le stock du net", async () => {
    const { batchId, resume } = await appliquerMouvements(CSV, "Import test", "2026-07-10", userId);
    expect(resume.rapprochees).toBe(1);

    const mvts = await prisma.mouvementStock.findMany({ where: { articleId }, orderBy: { type: "asc" } });
    expect(mvts.map((m) => m.type).sort()).toEqual(["ENTREE", "SORTIE"]);
    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(stock.quantite)).toBe(13); // 10 + 5 − 2

    // ImportBatch réversible enregistré.
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { operations: true } });
    expect(batch.operations.length).toBeGreaterThanOrEqual(3); // 1 Stock (avant) + 2 mouvements

    // Annulation : supprime les mouvements et restaure le stock exact.
    await annulerImport(batchId);
    expect(await prisma.mouvementStock.count({ where: { articleId } })).toBe(0);
    const restaure = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(restaure.quantite)).toBe(10);
  }, 60_000);

  it("refuse d'importer dans un mois clôturé", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 7, creeParId: userId } });
    await expect(appliquerMouvements(CSV, "Import test 2", "2026-07-10", userId)).rejects.toThrow(/clôturée/i);
    // Aucune écriture : le stock est resté à 10 (restauré au test précédent).
    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(stock.quantite)).toBe(10);
  }, 60_000);
});
