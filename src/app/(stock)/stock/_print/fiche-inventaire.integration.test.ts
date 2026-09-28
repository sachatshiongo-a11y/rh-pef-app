import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { policesDeRepli, pagesDuPdf } from "@/lib/test/pdf-lecture";

/**
 * Fiches d'inventaire Cuisine / Bar (demande de la Direction, 2026-09-28), bout à bout : la
 * route lit une VRAIE base (Postgres éphémère), rend le PDF, et le texte relu doit porter les
 * articles actifs de l'application, dans l'ordre de l'écran « Stock restaurant ».
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: "u", role: "STOCK", nom: "Stock" }), requireModule: () => {} }));

const { GET: ficheInventaire } = await import("../restaurant/fiche-inventaire/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.articleResto.deleteMany();
});

async function pdfDe(reponse: Response) {
  expect(reponse.status).toBe(200);
  expect(reponse.headers.get("Content-Type")).toBe("application/pdf");
  const pdf = Buffer.from(await reponse.arrayBuffer());
  const pages = await pagesDuPdf(pdf);
  return { pdf, pages, lignes: pages.flatMap((p) => p.lignes), plat: pages.map((p) => p.plat).join(" ") };
}

describe("fiches d'inventaire du restaurant", () => {
  async function semer() {
    await prisma.articleResto.createMany({
      data: [
        { espace: "CUISINE", categorie: "Viande - Volaille - Poisson - Crustacés", designation: "Blanc de poulet", unite: "Kg", ordre: 2 },
        { espace: "CUISINE", categorie: "Viande - Volaille - Poisson - Crustacés", designation: "Cailles", unite: "Pièce", ordre: 1 },
        { espace: "CUISINE", categorie: "Viande - Volaille - Poisson - Crustacés", designation: "Poulet fumé", unite: "Pièce", ordre: 3, actif: false },
        { espace: "CUISINE", categorie: "Crèmerie", designation: "Beurre", unite: "Pièce", ordre: 1 },
        { espace: "CUISINE", categorie: "Pâtes", designation: "Fusilli", unite: "Paquet", ordre: 1 },
        { espace: "CUISINE", categorie: null, designation: "Sel fin", unite: "Kg", ordre: 1 },
        { espace: "BAR", categorie: "Limonade et autre", designation: "Coca Cola", unite: "Bouteille", ordre: 1 },
        { espace: "BAR", categorie: "Bière locale", designation: "Castel", unite: "Bouteille", ordre: 1 },
        { espace: "BAR", categorie: "Bière locale", designation: "Tembo", unite: "Bouteille", ordre: 2, actif: false },
      ],
    });
  }
  const route = (espace: string) => ficheInventaire(new Request(`http://pef.test/stock/restaurant/fiche-inventaire?espace=${espace}`));

  it("Cuisine : titre, colonnes, rubriques dans l'ordre de l'écran, article inactif absent, rien du Bar", async () => {
    await semer();
    const { pdf, lignes, plat } = await pdfDe(await route("CUISINE"));
    expect(plat).toContain("Fiche d'inventaire Cuisine");
    expect(plat).toContain("Date :");
    expect(plat).toContain("Désignation Unité Stock cuisine Commentaire");
    const ordre = ["Crèmerie", "Beurre Pièce", "Pâtes", "Fusilli Paquet", "Viande - Volaille - Poisson - Crustacés", "Cailles Pièce", "Blanc de poulet Kg", "Sans catégorie", "Sel fin Kg"];
    const positions = ordre.map((t) => lignes.indexOf(t));
    expect(positions.every((p) => p >= 0), `lignes lues : ${lignes.join(" | ")}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(plat).not.toContain("Poulet fumé");
    expect(plat).not.toContain("Coca Cola");
    expect(plat).not.toContain("Bar Boissons");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 120_000);

  it("Bar : sa fiche à lui, colonne Catégorie, article inactif absent", async () => {
    await semer();
    const { pdf, lignes, plat } = await pdfDe(await route("BAR"));
    expect(plat).toContain("Fiche d'inventaire Bar Boissons");
    expect(plat).toContain("Désignation Catégorie Stock restaurant Commentaire");
    expect(lignes.indexOf("Castel Bière locale")).toBeGreaterThan(lignes.indexOf("Bière locale"));
    expect(lignes.indexOf("Coca Cola Limonade et autre")).toBeGreaterThan(lignes.indexOf("Castel Bière locale"));
    expect(plat).not.toContain("Tembo");
    expect(plat).not.toContain("Beurre");
    expect(plat).not.toContain("Fiche d'inventaire Cuisine");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 120_000);

  it("les deux : Cuisine puis Bar, le Bar sur une nouvelle page", async () => {
    await semer();
    const { pages } = await pdfDe(await route("TOUS"));
    const iBar = pages.findIndex((p) => p.plat.includes("Fiche d'inventaire Bar Boissons"));
    expect(pages[0].plat).toContain("Fiche d'inventaire Cuisine");
    expect(iBar).toBeGreaterThan(0);
    expect(pages[iBar].plat).not.toContain("Beurre");
    expect(pages.slice(0, iBar).map((p) => p.plat).join(" ")).not.toContain("Coca Cola");
  }, 120_000);

  it("sur plusieurs pages : l'en-tête de colonnes se répète, chaque article reste entier sur sa ligne", async () => {
    await prisma.articleResto.createMany({
      data: Array.from({ length: 70 }, (_, i) => ({
        espace: "CUISINE" as const,
        categorie: i < 35 ? "Crèmerie" : "Pâtes",
        designation: `Article ${String(i + 1).padStart(2, "0")}`,
        unite: "Kg",
        ordre: i,
      })),
    });
    const { pages, lignes } = await pdfDe(await route("CUISINE"));
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.plat).toContain("Désignation Unité Stock cuisine Commentaire");
    for (let i = 1; i <= 70; i++) expect(lignes.filter((l) => l === `Article ${String(i).padStart(2, "0")} Kg`)).toHaveLength(1);
  }, 120_000);
});
