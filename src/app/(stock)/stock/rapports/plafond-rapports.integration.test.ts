import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit du 10/10/2026, sécurité 2 : export « détail » des rapports Stock.
//  - les détails Factures et Bons de commande chargeaient TOUTE la table (bons AVEC leurs lignes)
//    puis filtraient en mémoire : la période est désormais lue EN BASE ;
//  - au-delà du plafond de 600 lignes (rendu par blocs, 13/10/2026), le PDF est refusé (413 lisible) AVANT tout rendu, et rien n'est
//    journalisé dans l'historique des rapports. Test d'INTÉGRATION (Postgres éphémère).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, lus: [] as { modele: string; n: number }[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      if (p === "factureFournisseur" || p === "bonDeCommande") {
        // Compte ce que la BASE renvoie (avant tout filtre en mémoire).
        const m = v as { findMany: (a: unknown) => Promise<unknown[]> };
        return new Proxy(m, { get: (t, q) => q === "findMany" ? async (a: unknown) => { const r = await t.findMany(a); H.lus.push({ modele: String(p), n: r.length }); return r; } : (t as never)[q] });
      }
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true, user: { id: "u1", nom: "Sacha", role: "ADMIN" } }) }));

const { GET } = await import("./export/route");
const { genererDonneesRapportDetail } = await import("@/lib/rapports");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const J = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "u1", email: "u1@pef.cd", nom: "Sacha", role: "ADMIN" } });
  const f = await prisma.fournisseur.create({ data: { nom: "Fourn" } });
  // Factures : datées dans / hors période, et sans date (repli sur le mois), aux bornes.
  const fac = (numero: string, date: string | null, annee: number, mois: number) =>
    prisma.factureFournisseur.create({ data: { numero, fournisseurId: f.id, fournisseurNom: "Fourn", date: date ? J(date) : null, annee, mois, montantUSD: 10, resteAPayerUSD: 10 } });
  await fac("IN-1", "2026-08-01", 2026, 8);
  await fac("IN-2", "2026-09-30", 2026, 9);
  await fac("OUT-1", "2026-07-31", 2026, 7);
  await fac("OUT-2", "2026-10-01", 2026, 10);
  await fac("OUT-3", "2025-08-15", 2025, 8);
  await fac("NUL-IN-1", null, 2026, 8);
  await fac("NUL-IN-2", null, 2026, 9);
  await fac("NUL-OUT-1", null, 2026, 7);
  await fac("NUL-OUT-2", null, 2026, 10);
  await fac("NUL-OUT-3", null, 2025, 9);
  const bc = (numero: string, sequence: number, date: string) =>
    prisma.bonDeCommande.create({ data: { numero, sequence, annee: Number(date.slice(0, 4)), mois: Number(date.slice(5, 7)), date: J(date), fournisseurId: f.id } });
  await bc("BC-IN", 1, "2026-08-10");
  await bc("BC-OUT-1", 2, "2026-07-31");
  await bc("BC-OUT-2", 3, "2026-10-01");
  // 1 501 mouvements dans la période : très au-delà du plafond du PDF (600 lignes).
  const a = await prisma.articleStock.create({ data: { designation: "Riz", domaine: "NOURRITURE" } });
  await prisma.mouvementStock.createMany({ data: Array.from({ length: 1501 }, (_, i) => ({ articleId: a.id, type: "ENTREE" as const, quantite: 1, date: J(`2026-09-${String((i % 28) + 1).padStart(2, "0")}`) })) });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("rapports Stock — détail borné à la période", () => {
  it("Factures : la base ne renvoie QUE les factures de la période (date, ou mois si sans date)", async () => {
    H.lus = [];
    const d = await genererDonneesRapportDetail("FACTURES", J("2026-08-01"), J("2026-09-30"));
    expect(d.lignes.map((l) => l[2]).sort()).toEqual(["IN-1", "IN-2", "NUL-IN-1", "NUL-IN-2"]);
    expect(H.lus).toEqual([{ modele: "factureFournisseur", n: 4 }]);
  }, 60_000);

  it("Bons de commande : la base ne renvoie QUE les bons de la période", async () => {
    H.lus = [];
    const d = await genererDonneesRapportDetail("BONS_COMMANDE", J("2026-08-01"), J("2026-09-30"));
    expect(d.lignes.map((l) => l[0])).toEqual(["BC-IN"]);
    expect(H.lus).toEqual([{ modele: "bonDeCommande", n: 1 }]);
  }, 60_000);
});

describe("rapports Stock — plafond du PDF", () => {
  const url = (format: string) => new Request(`http://x/stock/rapports/export?type=MOUVEMENTS&mode=detail&format=${format}&debut=2026-09-01&fin=2026-09-30`);

  it("1 501 mouvements en PDF détail : 413 lisible, AUCUNE ligne d'historique", async () => {
    await prisma.rapport.deleteMany();
    const t0 = Date.now();
    const r = await GET(url("pdf"));
    expect(r.status).toBe(413);
    expect(await r.text()).toMatch(/^Période trop longue : 1 501 lignes, maximum 600/);
    expect(Date.now() - t0).toBeLessThan(20_000); // refus avant rendu, pas après
    expect(await prisma.rapport.count()).toBe(0);
  }, 60_000);

  it("la même demande en Excel reste servie (pas de plafond : l'Excel ne coûte pas la mémoire du PDF)", async () => {
    const r = await GET(url("excel"));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
  }, 60_000);
});
