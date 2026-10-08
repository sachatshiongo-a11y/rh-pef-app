import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// HISTORIQUE DES IMPORTS — PAGINATION CÔTÉ SERVEUR (2026-10-08) : la page s'arrêtait en silence aux 50
// imports les plus récents (`take: 50`). Rendu de la VRAIE page : skip/take + count, ?page= et ?par=.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "imp@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});
vi.mock("./actions", () => ({
  analyserFacturesAction: async () => ({}), appliquerFacturesAction: async () => ({}), analyserMouvementsAction: async () => ({}), appliquerMouvementsAction: async () => ({}),
  detecterDoublonsAction: async () => ({}), retirerDoublonsAction: async () => ({}), annulerImportAction: async () => ({}),
  analyserInventaireAction: async () => ({}), appliquerInventaireAction: async () => ({}),
}));

let fermer: () => Promise<void>;
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
const libelles = (html: string) => [...html.matchAll(/Import n° (\d+)/g)].map((m) => Number(m[1]));

beforeAll(async () => {
  const db = await creerBaseTest();
  fermer = db.fermer; H.client = db.prisma;
  // 120 imports, « Import n° 120 » le plus récent.
  await db.prisma.importBatch.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({ type: "FACTURES", libelle: `Import n° ${i + 1}`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000) })),
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Imports — historique paginé côté serveur", () => {
  it("page 1 : les 50 plus récents (120 → 71), compteur sur les 120", async () => {
    const html = await rendre();
    const l = libelles(html);
    expect(l).toHaveLength(50);
    expect(l[0]).toBe(120);
    expect(l[49]).toBe(71);
    expect(texte(html)).toContain("1–50 sur 120");
  });
  it("page 3 : les 20 plus anciens ; 100 par page ; Tout", async () => {
    const p3 = libelles(await rendre({ page: "3" }));
    expect(p3).toHaveLength(20);
    expect(p3[19]).toBe(1);
    expect(libelles(await rendre({ par: "100" }))).toHaveLength(100);
    expect(libelles(await rendre({ par: "tout" }))).toHaveLength(120);
  });
  it("les liens de la barre sont de vrais liens ?page= / ?par=", async () => {
    const html = await rendre({ page: "2" });
    expect(html).toContain('href="/stock/imports?page=3"');
    expect(html).toContain('href="/stock/imports?par=100"'); // la 51e ligne est en page 1 de 100 : plus de ?page=
    expect(html).toContain("par=tout");
  });
});
