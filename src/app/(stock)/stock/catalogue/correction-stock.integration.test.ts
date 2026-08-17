import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Correction du stock négatif : remise à 0 via un mouvement d'ENTRÉE d'ajustement (traçable),
// sans toucher aux articles dont le stock est déjà positif.
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

const { corrigerStocksNegatifs } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("corrigerStocksNegatifs — remise à 0 des stocks négatifs", () => {
  it("remet le stock négatif à 0 avec un mouvement d'entrée, et laisse les stocks positifs intacts", async () => {
    const negatif = await prisma.articleStock.create({ data: { designation: "Farine (négatif)", domaine: "NOURRITURE" } });
    const positif = await prisma.articleStock.create({ data: { designation: "Sucre (positif)", domaine: "NOURRITURE" } });
    await prisma.stock.create({ data: { articleId: negatif.id, quantite: -5 } });
    await prisma.stock.create({ data: { articleId: positif.id, quantite: 8 } });

    const res = await corrigerStocksNegatifs([negatif.id, positif.id]);
    if ("erreur" in res) throw new Error(res.erreur);
    expect(res.corriges).toBe(1);

    // Le stock négatif est remonté à 0…
    const sNeg = await prisma.stock.findUnique({ where: { articleId: negatif.id } });
    expect(Number(sNeg!.quantite)).toBe(0);
    // …via un mouvement d'ENTRÉE d'ajustement de +5.
    const mvts = await prisma.mouvementStock.findMany({ where: { articleId: negatif.id } });
    expect(mvts).toHaveLength(1);
    expect(mvts[0].type).toBe("ENTREE");
    expect(Number(mvts[0].quantite)).toBe(5);
    expect(mvts[0].origine).toContain("Correction stock négatif");

    // Le stock positif n'est pas touché (aucun mouvement créé).
    const sPos = await prisma.stock.findUnique({ where: { articleId: positif.id } });
    expect(Number(sPos!.quantite)).toBe(8);
    expect(await prisma.mouvementStock.count({ where: { articleId: positif.id } })).toBe(0);
  }, 60_000);
});
