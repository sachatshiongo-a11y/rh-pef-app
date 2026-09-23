import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// La date d'effet de la paie sur heures planifiées est un PARAMÈTRE (ParametreLegal, ADMIN seul),
// jamais une date écrite dans le code. Absent = ancienne règle partout (bases pas encore migrées).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { chargerParametresPaie } = await import("./config");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let exerciceId: number;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  exerciceId = (await seedParametresLegaux(prisma, 2026)).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("paramètre paie_reference_planning_depuis", () => {
  it("absent → null (ancienne règle)", async () => {
    expect((await chargerParametresPaie()).referencePlanningDepuis).toBeNull();
  });
  it("présent → 202609 (lu en nombre)", async () => {
    await prisma.parametreLegal.create({ data: { exerciceId, cle: "paie_reference_planning_depuis", valeur: 202609, unite: "AAAAMM", libelle: "test" } });
    expect((await chargerParametresPaie()).referencePlanningDepuis).toBe(202609);
  });
  it("le seed de test sait le poser", async () => {
    const db2 = await creerBaseTest();
    try {
      await seedParametresLegaux(db2.prisma, 2026, { referencePlanningDepuis: 202609 });
      const p = await db2.prisma.parametreLegal.findFirst({ where: { cle: "paie_reference_planning_depuis" } });
      expect(Number(p?.valeur)).toBe(202609);
    } finally { await db2.fermer(); }
  }, 120_000);
});
