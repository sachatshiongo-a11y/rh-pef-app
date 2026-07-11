import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : le vrai enregistrerPaiement — paiement
// partiel, avoir, paiement en CDF (conversion au taux), soldé, et garde anti-dépassement.
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

const { enregistrerPaiement } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let factureId: string;

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const facture = () => prisma.factureFournisseur.findUniqueOrThrow({ where: { id: factureId } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "Testeur", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 7 } });
  const f = await prisma.factureFournisseur.create({
    data: { fournisseurNom: "ETS SENEVE", montantUSD: 100, montantRegleUSD: 0, resteAPayerUSD: 100, statut: "A_REGLER", mois: 7, annee: 2026 },
  });
  factureId = f.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("enregistrerPaiement — paiement / avoir / CDF / soldé / garde", () => {
  it("paiement partiel en USD : met à jour réglé/reste, statut A_REGLER", async () => {
    await enregistrerPaiement(factureId, fd({ type: "PAIEMENT", devise: "USD", montant: "40" }));
    const f = await facture();
    expect(Number(f.montantRegleUSD)).toBe(40);
    expect(Number(f.resteAPayerUSD)).toBe(60);
    expect(f.statut).toBe("A_REGLER");
    const p = await prisma.paiement.findMany({ where: { factureId } });
    expect(p).toHaveLength(1);
    expect(p[0].type).toBe("PAIEMENT");
  }, 60_000);

  it("avoir avec motif : réduit le reste, ligne de type AVOIR", async () => {
    await enregistrerPaiement(factureId, fd({ type: "AVOIR", devise: "USD", montant: "10", note: "Retour marchandise" }));
    const f = await facture();
    expect(Number(f.resteAPayerUSD)).toBe(50);
    const avoir = await prisma.paiement.findFirstOrThrow({ where: { factureId, type: "AVOIR" } });
    expect(Number(avoir.montantUSD)).toBe(10);
  }, 60_000);

  it("avoir sans motif : refusé", async () => {
    await expect(enregistrerPaiement(factureId, fd({ type: "AVOIR", devise: "USD", montant: "5" }))).rejects.toThrow(/motif de l'avoir/i);
  }, 60_000);

  it("paiement en CDF : converti au taux, montant FC + taux figés, facture soldée", async () => {
    // reste 50 $ → 50 × 2300 = 115 000 FC
    await enregistrerPaiement(factureId, fd({ type: "PAIEMENT", devise: "CDF", montant: "115000" }));
    const f = await facture();
    expect(Number(f.resteAPayerUSD)).toBe(0);
    expect(f.statut).toBe("REGLEE");
    expect(f.datePaiement).not.toBeNull();
    const cdf = await prisma.paiement.findFirstOrThrow({ where: { factureId, montantCDF: { not: null } } });
    expect(Number(cdf.montantUSD)).toBe(50);
    expect(Number(cdf.montantCDF)).toBe(115000);
    expect(Number(cdf.tauxChangeUtilise)).toBe(2300);
  }, 60_000);

  it("dépassement du reste à payer : refusé (facture déjà soldée)", async () => {
    await expect(enregistrerPaiement(factureId, fd({ type: "PAIEMENT", devise: "USD", montant: "5" }))).rejects.toThrow(/dépasse le reste/i);
  }, 60_000);
});
