import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// ARTICLES DÉSACTIVÉS DANS L'INVENTAIRE (Direction, 2026-10-14) : masqués par défaut, visibles par la pastille « Désactivés »
// (`?inactifs=1`), et les exports (Excel, PDF, page imprimable) suivent le filtre affiché. Postgres éphémère, vraies lectures.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "inv@pef.cd", accesStock: false, employeeId: null } }));
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

let prisma: PrismaClient;
let fermer: () => Promise<void>;

async function designationsExcel(url: string): Promise<string[]> {
  const { GET } = await import("./export/route");
  const ExcelJS = (await import("exceljs")).default;
  const res = await GET(new Request(url));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  const noms: string[] = [];
  wb.worksheets[0].eachRow((row) => { const v = String(row.getCell(2).value ?? ""); if (/^Art /.test(v)) noms.push(v); });
  return noms.sort();
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "inv@pef.cd", nom: "Sacha Test", role: "ADMIN" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const mk = async (designation: string, o: { actif: boolean; domaine?: "NOURRITURE" | "BOISSON"; quantite: number }) => {
    const a = await prisma.articleStock.create({ data: { designation, domaine: o.domaine ?? "NOURRITURE", unite: "Kg", prixUnitaireUSD: 2, actif: o.actif } });
    await prisma.stock.create({ data: { articleId: a.id, quantite: o.quantite, stockMinimum: 5 } });
  };
  await mk("Art Farine", { actif: true, quantite: 0 }); // URGENT
  await mk("Art Riz", { actif: true, quantite: 50 });
  await mk("Art Cola", { actif: true, domaine: "BOISSON", quantite: 20 });
  await mk("Art Ancien sirop", { actif: false, domaine: "BOISSON", quantite: 0 }); // désactivé, en rupture
  await mk("Art Vieille huile", { actif: false, quantite: 30 }); // désactivé
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("l'écran Inventaire : les désactivés sont envoyés marqués, pas mélangés aux actifs", () => {
  it("la page envoie TOUS les articles du domaine, les désactivés portant actif:false (les actifs n'ont pas le champ)", async () => {
    const { CatalogueView } = await import("./_view");
    const el = await CatalogueView({ searchParams: Promise.resolve({}) });
    const rows = (el.props as { rows: { designation: string; actif?: boolean }[]; inactifs: boolean }).rows;
    expect(rows.map((r) => [r.designation, r.actif]).sort()).toEqual([
      ["Art Ancien sirop", false], ["Art Cola", undefined], ["Art Farine", undefined], ["Art Riz", undefined], ["Art Vieille huile", false],
    ]);
    expect((el.props as { inactifs: boolean }).inactifs).toBe(false);
  });

  it("?inactifs=1 : la vue « Désactivés » est lue dans l'adresse", async () => {
    const { CatalogueView } = await import("./_view");
    const el = await CatalogueView({ searchParams: Promise.resolve({ inactifs: "1" }) });
    expect((el.props as { inactifs: boolean }).inactifs).toBe(true);
  });
});

describe("les exports suivent le filtre affiché : actifs par défaut, désactivés avec ?inactifs=1", () => {
  it("Excel sans filtre : les actifs seulement", async () => {
    expect(await designationsExcel("http://x/e")).toEqual(["Art Cola", "Art Farine", "Art Riz"]);
  });
  it("Excel ?inactifs=1 : les désactivés seulement (le domaine se cumule)", async () => {
    expect(await designationsExcel("http://x/e?inactifs=1")).toEqual(["Art Ancien sirop", "Art Vieille huile"]);
    expect(await designationsExcel("http://x/e?inactifs=1&domaine=BOISSON")).toEqual(["Art Ancien sirop"]);
  });
  it("l'alerte « Urgent » n'attrape pas le désactivé en rupture", async () => {
    expect(await designationsExcel("http://x/e?alerte=URGENT")).toEqual(["Art Farine"]);
  });
  it("PDF et page imprimable : le même ensemble (même filtre)", async () => {
    const { filtrerArticles } = await import("@/lib/inventaire-export");
    const { lireFiltreInventaire } = await import("@/lib/filtre-inventaire");
    const tous = await prisma.articleStock.findMany({ include: { stock: true, _count: { select: { fournisseurs: true } } } });
    const noms = (qs: string) => filtrerArticles(tous, new Map(), lireFiltreInventaire((k) => new URLSearchParams(qs).get(k))).map((a) => a.designation).sort();
    expect(noms("")).toEqual(["Art Cola", "Art Farine", "Art Riz"]);
    expect(noms("inactifs=1")).toEqual(["Art Ancien sirop", "Art Vieille huile"]);
  });
});

describe("compteurs : articles ACTIFS, comme l'accueil du Stock", () => {
  it("l'accueil du Stock compte les articles actifs (3), pas les 5 du catalogue", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
    expect(page).toMatch(/prisma\.articleStock\.count\(\{ where: \{ actif: true \} \}\)/);
    expect(await prisma.articleStock.count({ where: { actif: true } })).toBe(3);
  });
  it("indicateursStock (alertes, valeur) ignore les désactivés : une seule rupture", async () => {
    const { indicateursStock } = await import("@/lib/indicateurs/stock");
    const ind = await indicateursStock(new Date(), { nbAlertes: 8, mois: "2026-10" });
    expect(ind.nbUrgent).toBe(1);
  });
});
