import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit du 10/10/2026, stock 20 : la ligne d'historique d'un rapport n'est écrite qu'APRÈS un rendu réussi, et
// une seule fois pour une même demande répétée de suite. Test d'INTÉGRATION (Postgres éphémère).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, echec: false }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true, user: { id: "u1", nom: "Sacha", role: "ADMIN" } }) }));
// Rendu Excel : réel, sauf quand le test veut un échec de rendu.
vi.mock("@/lib/export-excel", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/export-excel")>();
  return { ...reel, classeurExcel: (...a: Parameters<typeof reel.classeurExcel>) => { if (H.echec) throw new Error("rendu impossible"); return reel.classeurExcel(...a); } };
});

const { GET } = await import("./export/route");
const { journaliserRapportGenere } = await import("@/lib/rapports-historique");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "u1", email: "u1@pef.cd", nom: "Sacha", role: "ADMIN" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => { H.echec = false; await prisma.rapport.deleteMany(); });

const demande = (extra = "") => new Request(`http://x/stock/rapports/export?type=MOUVEMENTS&format=excel&debut=2026-09-01&fin=2026-09-30${extra}`);

describe("historique des rapports", () => {
  it("un rendu réussi écrit UNE ligne ; la même demande répétée de suite n'en ajoute pas", async () => {
    for (let i = 0; i < 3; i++) expect((await GET(demande())).status).toBe(200);
    expect(await prisma.rapport.count()).toBe(1);
  }, 60_000);

  it("une demande DIFFÉRENTE (autre mode) a sa propre ligne", async () => {
    await GET(demande());
    await GET(demande("&mode=detail"));
    expect(await prisma.rapport.count()).toBe(2);
  }, 60_000);

  it("un rendu qui ÉCHOUE n'écrit rien dans l'historique", async () => {
    H.echec = true;
    await expect(GET(demande())).rejects.toThrow("rendu impossible");
    expect(await prisma.rapport.count()).toBe(0);
  }, 60_000);

  it("la fenêtre de répétition expire : au-delà, une nouvelle génération est journalisée", async () => {
    const r = { titre: "T", type: "MOUVEMENTS", mode: "chiffre", format: "pdf", periodeDebut: new Date("2026-09-01T00:00:00Z"), periodeFin: new Date("2026-09-30T00:00:00Z"), creeParId: "u1" };
    const t0 = new Date();
    expect(await journaliserRapportGenere(prisma, r, t0)).toBe(true);
    expect(await journaliserRapportGenere(prisma, r, new Date(t0.getTime() + 30_000))).toBe(false);
    expect(await journaliserRapportGenere(prisma, r, new Date(t0.getTime() + 10 * 60_000))).toBe(true);
    expect(await prisma.rapport.count()).toBe(2);
  }, 60_000);
});
