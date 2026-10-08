import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// EXPORTS DE L'INVENTAIRE (Excel, PDF) — ils sortent EXACTEMENT l'ensemble filtré affiché (2026-10-08) : recherche,
// alerte, « À compléter », hausse, domaine ; tout, jamais la page. Avant, l'Excel ignorait tout sauf le domaine et
// le PDF ne lisait que le début du nom.
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
  const u = await prisma.user.create({ data: { email: "inv@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const f = await prisma.fournisseur.create({ data: { nom: "SENEVE" } });
  const mk = async (designation: string, o: { domaine?: "NOURRITURE" | "BOISSON"; quantite: number; min: number; prix?: number; fournisseur?: boolean; code?: string }) => {
    const a = await prisma.articleStock.create({
      data: { designation, code: o.code, domaine: o.domaine ?? "NOURRITURE", unite: "Kg", prixUnitaireUSD: o.prix ?? null, fournisseurId: o.fournisseur ? f.id : null },
    });
    await prisma.stock.create({ data: { articleId: a.id, quantite: o.quantite, stockMinimum: o.min } });
    return a;
  };
  await mk("Art Farine", { quantite: 0, min: 5, prix: 2, fournisseur: true, code: "101" }); // URGENT
  await mk("Art Sucre", { quantite: 3, min: 5, prix: 1, fournisseur: true, code: "102" }); // APPRO
  await mk("Art Riz", { quantite: 50, min: 5, prix: 1, fournisseur: true, code: "103" }); // OK
  await mk("Art Huile", { quantite: 40, min: 5, fournisseur: true, code: "104" }); // OK, sans prix
  await mk("Art Sel", { quantite: 40, min: 5, prix: 1, code: "105" }); // OK, sans fournisseur
  await mk("Art Cola", { domaine: "BOISSON", quantite: 0, min: 5, prix: 1, fournisseur: true, code: "201" }); // URGENT, boisson
  await mk("Art Négatif", { quantite: -2, min: 5, prix: 1, fournisseur: true, code: "106" }); // stock négatif (APPRO? q<=0 → URGENT)
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Excel de l'Inventaire — l'ensemble filtré affiché", () => {
  it("sans filtre : tout le domaine demandé (ou tous)", async () => {
    expect(await designationsExcel("http://x/e")).toHaveLength(7);
    expect(await designationsExcel("http://x/e?domaine=BOISSON")).toEqual(["Art Cola"]);
  });
  it("alerte : seulement les urgents (et le domaine se cumule)", async () => {
    expect(await designationsExcel("http://x/e?alerte=URGENT")).toEqual(["Art Cola", "Art Farine", "Art Négatif"]);
    expect(await designationsExcel("http://x/e?alerte=URGENT&domaine=NOURRITURE")).toEqual(["Art Farine", "Art Négatif"]);
    expect(await designationsExcel("http://x/e?alerte=APPRO")).toEqual(["Art Sucre"]);
  });
  it("recherche sur le nom OU le code, sans accent", async () => {
    expect(await designationsExcel("http://x/e?q=farine")).toEqual(["Art Farine"]);
    expect(await designationsExcel("http://x/e?q=103")).toEqual(["Art Riz"]);
    expect(await designationsExcel("http://x/e?q=negatif")).toEqual(["Art Négatif"]);
  });
  it("« À compléter » : sans prix, sans fournisseur, stock négatif", async () => {
    expect(await designationsExcel("http://x/e?manque=prix")).toEqual(["Art Huile"]);
    expect(await designationsExcel("http://x/e?manque=fournisseur")).toEqual(["Art Sel"]);
    expect(await designationsExcel("http://x/e?manque=negatif")).toEqual(["Art Négatif"]);
  });
  it("hausse de prix : aucun article en hausse ici → rien (et non « tout »)", async () => {
    expect(await designationsExcel("http://x/e?hausse=1")).toEqual([]);
  });
  it("les filtres se cumulent ; page et taille de page dans l'adresse sont sans effet", async () => {
    expect(await designationsExcel("http://x/e?alerte=OK&manque=prix&page=2&par=50")).toEqual(["Art Huile"]);
    expect(await designationsExcel("http://x/e?page=3&par=50")).toHaveLength(7);
  });
});

describe("PDF et page imprimable de l'Inventaire — le même filtre", () => {
  it("le PDF accepte le filtre complet (réponse PDF)", async () => {
    const { GET } = await import("./pdf/route");
    const res = await GET(new Request("http://x/p?alerte=URGENT&q=art&manque=&hausse=0&domaine=NOURRITURE"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });
  it("la page imprimable ne liste que l'ensemble filtré", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: Page } = await import("./imprimer/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ alerte: "URGENT", domaine: "NOURRITURE" }) }));
    expect(html).toContain("Art Farine");
    expect(html).toContain("Art Négatif");
    expect(html).not.toContain("Art Riz");
    expect(html).not.toContain("Art Cola");
  });
});
