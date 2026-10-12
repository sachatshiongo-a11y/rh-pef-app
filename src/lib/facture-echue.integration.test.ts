import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le KPI « Échu » et le filtre « Échues » comptent une facture dont l'échéance est PASSÉE, même si son statut
// stocké est resté « À régler » (audit du 10/10/2026, constat 3) — sur la vraie base (Prisma ET SQL brut).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));

const { whereEchues, whereAReglerNonEchues, whereSelonFiltreStatut } = await import("@/lib/facture-echue");
const { sqlEchue } = await import("@/lib/facture-echue-sql");
const { Prisma } = await import("@prisma/client");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const AUJ = "2026-10-10";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const f = (nom: string, o: Record<string, unknown>) => prisma.factureFournisseur.create({ data: { fournisseurNom: nom, mois: 9, annee: 2026, montantUSD: 100, montantRegleUSD: 0, resteAPayerUSD: 100, ...o } });
  // Statut STOCKÉ « À régler » alors que l'échéance est passée depuis 10 jours : l'ancien KPI l'ignorait.
  await f("EN RETARD (stocké À régler)", { statut: "A_REGLER", dateEcheance: new Date("2026-09-30") });
  await f("A VENIR", { statut: "A_REGLER", dateEcheance: new Date("2026-10-20") });
  await f("SANS ECHEANCE", { statut: "A_REGLER" });
  await f("PAYEE", { statut: "REGLEE", montantRegleUSD: 100, resteAPayerUSD: 0, dateEcheance: new Date("2026-01-01") });
  await f("EN FRANCS EN RETARD", { statut: "A_REGLER", devise: "CDF", montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null, montantCDF: 280000, montantRegleCDF: 0, resteAPayerCDF: 280000, dateEcheance: new Date("2026-10-09") });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("échue : jugée à la lecture, Prisma comme SQL", () => {
  it("whereEchues retrouve les factures en retard dont le statut stocké est resté « À régler »", async () => {
    const noms = (await prisma.factureFournisseur.findMany({ where: whereEchues(AUJ), orderBy: { fournisseurNom: "asc" } })).map((x) => x.fournisseurNom);
    expect(noms).toEqual(["EN FRANCS EN RETARD", "EN RETARD (stocké À régler)"]);
  }, 60_000);
  it("le filtre « À régler » ne garde que les non échues, le filtre « du » garde tout ce qui n'est pas réglé", async () => {
    expect((await prisma.factureFournisseur.findMany({ where: whereAReglerNonEchues(AUJ), orderBy: { fournisseurNom: "asc" } })).map((x) => x.fournisseurNom)).toEqual(["A VENIR", "SANS ECHEANCE"]);
    expect(await prisma.factureFournisseur.count({ where: whereSelonFiltreStatut("du", AUJ) })).toBe(4);
  }, 60_000);
  it("l'agrégat SQL du KPI « Échu » donne le même résultat, par devise", async () => {
    const [r] = await prisma.$queryRaw<{ echu: number; echuCDF: number; nb: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM("resteAPayerUSD") FILTER (WHERE ${sqlEchue(AUJ)}), 0)::float AS echu,
             COALESCE(SUM("resteAPayerCDF") FILTER (WHERE ${sqlEchue(AUJ)}), 0)::float AS "echuCDF",
             COUNT(*) FILTER (WHERE ${sqlEchue(AUJ)})::int AS nb
      FROM "stock"."FactureFournisseur"`);
    expect(r).toEqual({ echu: 100, echuCDF: 280000, nb: 2 });
  }, 60_000);
});
