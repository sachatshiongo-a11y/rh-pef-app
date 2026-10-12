import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Clôture mensuelle du stock — audit du 10/10/2026, stock 14 : le mois en cours et les mois futurs sont
// refusés, un mois déjà clôturé n'est pas reclôturé (son instantané n'est pas réécrit), « Rouvrir » passe par
// `formulaireLisible` (l'erreur revient par la page). Test d'INTÉGRATION (Postgres éphémère).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Sacha", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { url }); } }));

const { cloturerMoisStock, rouvrirMoisStock } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T09:00:00Z"));
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const u = await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Sacha", role: "ADMIN" } });
  A.user.id = u.id;
  const a = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "2.5" } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: "10" } });
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });
beforeEach(async () => { await prisma.clotureStock.deleteMany(); });

/** L'erreur renvoyée à la page (`?erreur=`), ou null si l'action a abouti. */
async function erreurDe(fait: () => Promise<void>): Promise<string | null> {
  try { await fait(); return null; } catch (e) {
    const url = (e as { url?: string }).url;
    if (!url) throw e;
    return decodeURIComponent(new URL(url, "http://x").searchParams.get("erreur") ?? "");
  }
}

describe("cloturerMoisStock", () => {
  it("refuse le mois en cours et les mois futurs", async () => {
    expect(await erreurDe(() => cloturerMoisStock(2026, 10))).toMatch(/octobre 2026 n'est pas terminé/);
    expect(await erreurDe(() => cloturerMoisStock(2026, 11))).toMatch(/novembre 2026 n'a pas commencé/);
    expect(await erreurDe(() => cloturerMoisStock(2027, 1))).toMatch(/n'a pas commencé/);
    expect(await prisma.clotureStock.count()).toBe(0);
  });

  it("clôture un mois terminé : l'instantané date du moment, avec le nombre d'articles sans prix", async () => {
    expect(await erreurDe(() => cloturerMoisStock(2026, 9))).toBeNull();
    const c = await prisma.clotureStock.findUniqueOrThrow({ where: { annee_mois: { annee: 2026, mois: 9 } } });
    expect(c.createdAt.toISOString()).toBe("2026-10-10T09:00:00.000Z");
    expect((c.snapshot as { valeurTotaleUSD: number }).valeurTotaleUSD).toBe(25);
  });

  it("refuse de reclôturer un mois déjà clos : l'instantané n'est pas réécrit ; rouvrir d'abord", async () => {
    await cloturerMoisStock(2026, 9);
    const avant = await prisma.clotureStock.findUniqueOrThrow({ where: { annee_mois: { annee: 2026, mois: 9 } } });
    await prisma.stock.updateMany({ data: { quantite: "99" } });
    expect(await erreurDe(() => cloturerMoisStock(2026, 9))).toMatch(/septembre 2026 est déjà clôturé.*Rouvrez le mois d'abord/);
    const apres = await prisma.clotureStock.findUniqueOrThrow({ where: { annee_mois: { annee: 2026, mois: 9 } } });
    expect(apres.snapshot).toEqual(avant.snapshot);
    expect(await erreurDe(() => rouvrirMoisStock(2026, 9))).toBeNull();
    await prisma.stock.updateMany({ data: { quantite: "10" } });
  });

  it("Rouvrir passe par formulaireLisible : un mois non clôturé revient en message lisible, pas en page d'erreur", async () => {
    expect(await erreurDe(() => rouvrirMoisStock(2026, 8))).toMatch(/n'est pas clôturé/);
  });

  it("un compte non-Direction est refusé", async () => {
    A.user = { ...A.user, role: "STOCK" };
    expect(await erreurDe(() => cloturerMoisStock(2026, 9))).toMatch(/Accès refusé/);
    expect(await erreurDe(() => rouvrirMoisStock(2026, 9))).toMatch(/Accès refusé/);
    A.user = { ...A.user, role: "ADMIN" };
  });

  it("(lot 8, V8) un refus revient sur la page « Clôture du mois » du Stock, plus sur Paramètres", async () => {
    for (const geste of [() => cloturerMoisStock(2026, 10), () => rouvrirMoisStock(2026, 8)]) {
      let url = "";
      try { await geste(); } catch (e) { url = (e as { url?: string }).url ?? ""; }
      expect(url).toMatch(/^\/stock\/cloture\?erreur=/);
    }
  });

  it("(lot 8, V8) mêmes droits qu'avant : la Direction seule clôture et rouvre, STOCK / MANAGER / VIEWER / COMPTA refusés, rien d'écrit", async () => {
    for (const role of ["STOCK", "MANAGER", "VIEWER", "COMPTA"]) {
      A.user = { ...A.user, role };
      expect(await erreurDe(() => cloturerMoisStock(2026, 9)), role).toMatch(/Accès refusé/);
    }
    expect(await prisma.clotureStock.count()).toBe(0);
    A.user = { ...A.user, role: "ADMIN" };
  });
});
