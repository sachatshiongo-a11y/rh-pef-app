import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : marquerPayee et marquerPayeesEnLot
// avec une date de paiement au choix — la Direction demande de dater le règlement, pas
// systématiquement « aujourd'hui » (et surtout pas `now()`, l'heure du SERVEUR en UTC).
import { vi } from "vitest";
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { marquerPayee, marquerPayeesEnLot } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "Testeur", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  // Base vide entre chaque test : chaque cas crée ses propres factures.
  await prisma.paiement.deleteMany();
  await prisma.factureFournisseur.deleteMany();
});

const creerFacture = (o: Partial<{ fournisseurNom: string; numero: string | null; date: Date | null; montantUSD: number }> = {}) =>
  prisma.factureFournisseur.create({
    data: {
      fournisseurNom: o.fournisseurNom ?? "ETS SENEVE",
      numero: o.numero ?? null,
      date: o.date ?? null,
      montantUSD: o.montantUSD ?? 100,
      montantRegleUSD: 0,
      resteAPayerUSD: o.montantUSD ?? 100,
      statut: "A_REGLER",
      mois: 9, annee: 2026,
    },
  });

describe("marquerPayee — date au choix", () => {
  it("avec une date passée : Paiement.date et FactureFournisseur.datePaiement portent cette date", async () => {
    const f = await creerFacture({ date: new Date("2026-09-01T00:00:00.000Z") });
    await marquerPayee(f.id, "2026-09-10");
    const relu = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(relu.statut).toBe("REGLEE");
    expect(relu.datePaiement?.toISOString().slice(0, 10)).toBe("2026-09-10");
    const p = await prisma.paiement.findFirstOrThrow({ where: { factureId: f.id } });
    expect(p.date.toISOString().slice(0, 10)).toBe("2026-09-10");
  }, 60_000);

  it("date de paiement dans le futur : refusée, rien n'est écrit", async () => {
    const f = await creerFacture();
    const demain = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(marquerPayee(f.id, demain)).resolves.toMatchObject({ erreur: expect.stringMatching(/ne peut pas être dans le futur/i) });
    const relu = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(relu.statut).toBe("A_REGLER");
    expect(Number(relu.resteAPayerUSD)).toBe(100);
    expect(await prisma.paiement.count({ where: { factureId: f.id } })).toBe(0);
  }, 60_000);
});

describe("marquerPayeesEnLot — même date pour tout le lot, tout ou rien", () => {
  it("toutes les factures et tous les paiements du lot portent la date choisie", async () => {
    const f1 = await creerFacture({ fournisseurNom: "A", date: new Date("2026-09-01T00:00:00.000Z") });
    const f2 = await creerFacture({ fournisseurNom: "B", date: new Date("2026-09-05T00:00:00.000Z") });
    await marquerPayeesEnLot([f1.id, f2.id], "2026-09-10");
    for (const id of [f1.id, f2.id]) {
      const relu = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
      expect(relu.statut).toBe("REGLEE");
      expect(relu.datePaiement?.toISOString().slice(0, 10)).toBe("2026-09-10");
      const p = await prisma.paiement.findFirstOrThrow({ where: { factureId: id } });
      expect(p.date.toISOString().slice(0, 10)).toBe("2026-09-10");
    }
  }, 60_000);

  it("une facture du lot a une date de facture postérieure à la date choisie : RIEN n'est réglé (lot entier refusé)", async () => {
    const f1 = await creerFacture({ fournisseurNom: "A", numero: "A-1", date: new Date("2026-09-01T00:00:00.000Z") });
    const f2 = await creerFacture({ fournisseurNom: "B", numero: "B-9", date: new Date("2026-09-20T00:00:00.000Z") }); // postérieure à la date choisie
    const r = await marquerPayeesEnLot([f1.id, f2.id], "2026-09-10");
    expect(r).toMatchObject({ erreur: expect.stringMatching(/B.*B-9.*antérieure à la date de la facture/i) });
    // Base relue : ni f1 ni f2 ne sont réglées, aucun paiement créé pour l'une ou l'autre.
    const [r1, r2] = await Promise.all([
      prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f1.id } }),
      prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f2.id } }),
    ]);
    expect(r1.statut).toBe("A_REGLER");
    expect(r2.statut).toBe("A_REGLER");
    expect(await prisma.paiement.count({ where: { factureId: { in: [f1.id, f2.id] } } })).toBe(0);
  }, 60_000);

  it("date de paiement dans le futur : rien n'est écrit", async () => {
    const f = await creerFacture();
    const demain = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(marquerPayeesEnLot([f.id], demain)).resolves.toMatchObject({ erreur: expect.stringMatching(/ne peut pas être dans le futur/i) });
    const relu = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: f.id } });
    expect(relu.statut).toBe("A_REGLER");
    expect(await prisma.paiement.count({ where: { factureId: f.id } })).toBe(0);
  }, 60_000);
});
