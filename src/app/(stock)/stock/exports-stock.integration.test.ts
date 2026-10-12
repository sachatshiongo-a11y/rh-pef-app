import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Tous les exports PDF / Excel du Stock sur des articles qui portent une MARQUE, une contenance et un prix en francs
// (12/10/2026 : l'export « Inventaire + mouvements » de la Clôture du mois ne partait plus — on vérifie qu'aucun
// autre export n'a le même défaut). Test d'INTÉGRATION (Postgres éphémère), session Direction simulée.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true, user: { id: "u1", nom: "Sacha", role: "ADMIN" } }) }));

const catalogueExcel = (await import("./catalogue/export/route")).GET;
const cataloguePdf = (await import("./catalogue/pdf/route")).GET;
const articlePdf = (await import("./catalogue/[id]/pdf/route")).GET;
const fournisseursExcel = (await import("./fournisseurs/export/route")).GET;
const rapports = (await import("./rapports/export/route")).GET;
const { TYPES_RAPPORT } = await import("@/lib/rapports");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId = "";
const J = (iso: string) => new Date(`${iso}T00:00:00Z`);
const req = (chemin: string) => new Request(`http://localhost${chemin}`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "u1", email: "u1@pef.cd", nom: "Sacha", role: "ADMIN" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const cat = await prisma.categorieStock.create({ data: { nom: "Épicerie", domaine: "NOURRITURE" } });
  const f = await prisma.fournisseur.create({ data: { nom: "Fourn" } });
  const defs = [
    { designation: "Vodka", marque: "Absolut", domaine: "BOISSON" as const, contenance: "70", contenanceUnite: "cl", prixUnitaireUSD: "12.5" },
    { designation: "Beurre", marque: "Président", domaine: "NOURRITURE" as const, contenance: "250", contenanceUnite: "g", prixUnitaireUSD: "3" },
    { designation: "Sucre", marque: null, domaine: "NOURRITURE" as const, contenance: null, contenanceUnite: null, prixUnitaireUSD: null, devisePrix: "CDF" as const, prixUnitaireCDF: "7000" },
  ];
  for (const [i, d] of defs.entries()) {
    const a = await prisma.articleStock.create({ data: { ...d, code: String(i + 1), unite: "kg", categorieId: cat.id, fournisseurId: f.id } });
    articleId = a.id;
    await prisma.stock.create({ data: { articleId: a.id, quantite: "10", stockMinimum: "5", seuilUrgent: "2" } });
    for (const [j, type] of (["ENTREE", "SORTIE"] as const).entries()) {
      await prisma.mouvementStock.create({ data: { articleId: a.id, type, quantite: "2.5", date: J(`2026-09-${String(j + 3).padStart(2, "0")}`), montantUSD: "7.5" } });
    }
  }
}, 120_000);
afterAll(async () => { await fermer?.(); });

async function verifier(res: Response, signature: "%PDF-" | "PK") {
  expect(res.status).toBe(200);
  const buf = Buffer.from(await res.arrayBuffer());
  expect(buf.subarray(0, signature.length).toString()).toBe(signature);
}

describe("exports du Stock — articles avec marque", () => {
  it("catalogue : Excel", async () => verifier(await catalogueExcel(req("/stock/catalogue/export")), "PK"), 60_000);
  it("catalogue : PDF", async () => verifier(await cataloguePdf(req("/stock/catalogue/pdf")), "%PDF-"), 60_000);
  it("fiche article : PDF", async () => verifier(await articlePdf(req(`/stock/catalogue/${articleId}/pdf`), { params: Promise.resolve({ id: articleId }) }), "%PDF-"), 60_000);
  it("fournisseurs : Excel", async () => verifier(await fournisseursExcel(req("/stock/fournisseurs/export")), "PK"), 60_000);

  for (const type of Object.keys(TYPES_RAPPORT)) {
    for (const mode of ["chiffre", "detail"]) {
      for (const [format, signature] of [["pdf", "%PDF-"], ["excel", "PK"]] as const) {
        it(`rapport ${type} (${mode}) : ${format}`, async () => {
          await verifier(await rapports(req(`/stock/rapports/export?type=${type}&mode=${mode}&format=${format}&debut=2026-09-01&fin=2026-09-30`)), signature);
        }, 60_000);
      }
    }
  }
});
