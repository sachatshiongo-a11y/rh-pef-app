import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Anti-force-brute (5 échecs / 15 min) et jetons de réinitialisation (usage unique, expiration,
// invalidation des anciens) — sur Postgres éphémère.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { minutesBlocage, enregistrerEchec, effacerEchecs, genererJetonReinitialisation, verifierJeton, consommerJeton, MAX_ECHECS } =
  await import("@/lib/securite-connexion");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("anti-force-brute", () => {
  it("bloque après 5 échecs, insensible à la casse, débloqué par effacerEchecs", async () => {
    for (let i = 0; i < MAX_ECHECS - 1; i++) await enregistrerEchec("Test@Pef.cd", "1.2.3.4");
    expect(await minutesBlocage("test@pef.cd")).toBe(0); // 4 échecs → pas bloqué
    await enregistrerEchec("test@pef.cd", null);
    expect(await minutesBlocage("TEST@pef.cd")).toBeGreaterThan(0); // 5e → bloqué
    expect(await minutesBlocage("autre@pef.cd")).toBe(0); // autre email non affecté
    await effacerEchecs("test@pef.cd");
    expect(await minutesBlocage("test@pef.cd")).toBe(0);
  }, 60_000);
});

describe("jetons de réinitialisation", () => {
  it("valide → email ; usage unique ; nouveau jeton invalide l'ancien ; expiré → null", async () => {
    const t1 = await genererJetonReinitialisation("reset@pef.cd");
    expect(await verifierJeton(t1)).toBe("reset@pef.cd");

    // Un nouveau jeton invalide le précédent.
    const t2 = await genererJetonReinitialisation("reset@pef.cd");
    expect(await verifierJeton(t1)).toBeNull();
    expect(await verifierJeton(t2)).toBe("reset@pef.cd");

    // Usage unique.
    await consommerJeton(t2);
    expect(await verifierJeton(t2)).toBeNull();

    // Expiré → null.
    const t3 = await genererJetonReinitialisation("reset@pef.cd");
    await prisma.jetonReinitialisation.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifierJeton(t3)).toBeNull();

    // Jeton fantaisiste → null.
    expect(await verifierJeton("nimportequoi")).toBeNull();
  }, 60_000);
});
