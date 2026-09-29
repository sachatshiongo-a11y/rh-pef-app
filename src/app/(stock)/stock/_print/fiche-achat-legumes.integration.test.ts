import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { policesDeRepli, pagesDuPdf } from "@/lib/test/pdf-lecture";

/**
 * Fiche d'achat de légumes (demande de la Direction, 2026-09-28), bout à bout : la route lit une
 * VRAIE base (Postgres éphémère), rend le PDF, et le texte relu doit porter ce qui a été
 * enregistré — au bon légume, au bon jour.
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

const { GET: ficheAchat } = await import("../legumes/fiche/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.achatLegume.deleteMany();
});

async function pdfDe(reponse: Response) {
  expect(reponse.status).toBe(200);
  expect(reponse.headers.get("Content-Type")).toBe("application/pdf");
  const pdf = Buffer.from(await reponse.arrayBuffer());
  const pages = await pagesDuPdf(pdf);
  return { pdf, pages, lignes: pages.flatMap((p) => p.lignes), plat: pages.map((p) => p.plat).join(" ") };
}

describe("fiche d'achat de légumes", () => {
  const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("remplie pour une date : les achats de CE jour au bon légume, total CDF juste, hors-liste en fin", async () => {
    await prisma.achatLegume.createMany({
      data: [
        { date: le("2026-09-28"), legume: "Ail", unite: "Kg", quantite: 2.5, montantCDF: 12500, montantUSD: 4.46, tauxChangeUtilise: 2800 },
        { date: le("2026-09-28"), legume: "Oignons", unite: "Kg", quantite: 10, montantCDF: 25000, montantUSD: 8.93, tauxChangeUtilise: 2800 },
        { date: le("2026-09-28"), legume: "Oignons", unite: "Kg", quantite: 5, montantCDF: 12500, montantUSD: 4.46, tauxChangeUtilise: 2800 },
        { date: le("2026-09-28"), legume: "Champignons de Paris", unite: "Kg", quantite: 1.25, montantCDF: 1234567.5, montantUSD: 440.92, tauxChangeUtilise: 2800 },
        // La veille : ne doit pas apparaître.
        { date: le("2026-09-27"), legume: "Aubergine", unite: "Kg", quantite: 3, montantCDF: 9000, montantUSD: 3.21, tauxChangeUtilise: 2800 },
      ],
    });
    const { pdf, lignes, plat } = await pdfDe(await ficheAchat(new Request("http://pef.test/stock/legumes/fiche?date=2026-09-28")));
    expect(plat).toContain("Achat de légumes Marché");
    expect(plat).toContain("Date : 28/09/2026");
    expect(lignes).toContain("Ail Kg 2,5 12 500");
    expect(lignes).toContain("Oignons Kg 15 37 500");
    expect(lignes).toContain("Aubergine Kg"); // acheté la veille seulement : vide ce jour
    const horsListe = lignes.indexOf("Champignons de Paris Kg 1,25 1 234 567,5");
    expect(lignes.indexOf("Feuilles de menthe Botte")).toBeGreaterThan(-1);
    expect(horsListe).toBeGreaterThan(lignes.indexOf("Feuilles de menthe Botte"));
    expect(plat).toContain("Montant total CDF 1 284 567,5");
    expect(plat).toContain("Montant total $ 458,77");
    expect(plat).toMatch(/Montant donné \$ Montant total CDF/); // « Montant donné $ » reste vide
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 120_000);

  it("vierge : les 38 légumes sans quantité ni montant, date et totaux à remplir", async () => {
    await prisma.achatLegume.create({ data: { date: le("2026-09-28"), legume: "Ail", unite: "Kg", quantite: 2.5, montantCDF: 12500 } });
    const { pdf, pages, lignes, plat } = await pdfDe(await ficheAchat(new Request("http://pef.test/stock/legumes/fiche")));
    expect(pages).toHaveLength(1);
    expect(lignes).toContain("Ail Kg");
    expect(lignes).toContain("Menthe Botte");
    expect(plat).toMatch(/Date : Désignation Unité QTÉ Montant/);
    expect(plat).toMatch(/Montant donné \$ Montant total CDF Montant total \$/);
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 120_000);

  it("une date illisible est refusée plutôt que de rendre une fiche d'un autre jour", async () => {
    expect((await ficheAchat(new Request("http://pef.test/stock/legumes/fiche?date=2026-02-31"))).status).toBe(400);
    expect((await ficheAchat(new Request("http://pef.test/stock/legumes/fiche?date=hier"))).status).toBe(400);
  });
});
