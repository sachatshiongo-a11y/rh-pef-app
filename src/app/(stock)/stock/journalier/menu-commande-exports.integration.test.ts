import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";

/**
 * Menu « Commande journalière (PDF / Excel) » de l'onglet Commande, bout à bout : chaque lien du menu
 * (un jour, toute la semaine, tableau de la semaine ; PDF et Excel) est appelé sur une VRAIE base avec
 * une semaine réaliste (cuisine, bar, légumes, unités variées, nom court, légume acheté dans une
 * autre unité), et doit répondre 200 avec un fichier valide. Même famille : exports des vues
 * Consommation et Comparaison.
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

const { GET: fiche } = await import("./fiche/route");
const { GET: tableauPdf } = await import("./pdf/route");
const { GET: tableauExcel } = await import("./excel/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SEMAINE = "2026-10-12"; // lundi
const JOURS = ["12", "13", "14", "15", "16", "17", "18"].map((j) => `2026-10-${j}`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const viande = await prisma.categorieStock.create({ data: { nom: "Viande", domaine: "NOURRITURE" } });
  const bieres = await prisma.categorieStock.create({ data: { nom: "Bière locale", domaine: "BOISSON" } });
  const art = (designation: string, domaine: "NOURRITURE" | "BOISSON", categorieId: string, unite: string | null, extra: object = {}) =>
    prisma.articleStock.create({ data: { designation, domaine, categorieId, unite, surFicheCommande: true, ...extra } });
  const articles = [
    await art("Filet pur Boeuf", "NOURRITURE", viande.id, "Kg"),
    await art("Lamb Rack NZ Frozen Frenched 1kg", "NOURRITURE", viande.id, "Kg", { nomCourt: "Carré d'agneau" }),
    await art("Castel 33cl", "BOISSON", bieres.id, "Bouteille(s)", { contenance: 33, contenanceUnite: "cl" }),
    await art("Beurre", "NOURRITURE", viande.id, null),
    await art("Pâtes Penne", "NOURRITURE", viande.id, "Cartons"),
  ];
  for (const [i, a] of articles.entries()) {
    for (const j of JOURS) {
      await prisma.commandeResto.create({ data: { articleId: a.id, date: le(j), quantite: i + 1.5 } });
      await prisma.mouvementStock.create({ data: { articleId: a.id, type: "SORTIE", quantite: i + 1, date: le(j), categorieSortie: "LIVRAISON_RESTAURANT" } });
    }
  }
  // Légumes : commande dans l'unité de la liste, achats dans une autre unité, légume hors liste.
  for (const j of JOURS) {
    await prisma.commandeLegumeResto.create({ data: { legume: "Ail", date: le(j), quantite: 3 } });
    await prisma.commandeLegumeResto.create({ data: { legume: "Persil frisé", date: le(j), quantite: 2 } }); // hors liste
    await prisma.achatLegume.create({ data: { legume: "Ail", unite: "Sac", date: le(j), quantite: 2 } });
    await prisma.achatLegume.create({ data: { legume: "ail", unite: "Kg", date: le(j), quantite: 1.25 } });
    await prisma.achatLegume.create({ data: { legume: "Menthe", unite: "Botte(s)", date: le(j), quantite: 4 } });
    await prisma.achatLegume.create({ data: { legume: "Cerfeuil", unite: null, date: le(j), quantite: 1 } });
  }
  // Restaurant : articles, comptages.
  const coca = await prisma.articleResto.create({ data: { espace: "BAR", categorie: "Limonade", designation: "Coca", unite: "Bouteille", ordre: 1 } });
  for (const [k, j] of JOURS.entries()) await prisma.comptageResto.create({ data: { articleRestoId: coca.id, date: le(j), quantite: 40 - k } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

async function ficheGet(qs: string) {
  const r = await fiche(new Request(`http://pef.test/stock/journalier/fiche?${qs}`));
  return { r, buf: Buffer.from(await r.arrayBuffer()) };
}
const estPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-" && b.includes("%%EOF");
const estXlsx = (b: Buffer) => b.subarray(0, 2).toString("latin1") === "PK";

describe("menu Commande : chaque lien produit un fichier valide", () => {
  it("Un jour, PDF", async () => {
    const { r, buf } = await ficheGet(`type=commande&date=${JOURS[1]}&format=pdf`);
    expect(r.status).toBe(200);
    expect(estPdf(buf)).toBe(true);
    expect((await pagesDuPdf(buf)).length).toBeGreaterThan(0);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("Un jour, Excel", async () => {
    const { r, buf } = await ficheGet(`type=commande&date=${JOURS[1]}&format=excel`);
    expect(r.status).toBe(200);
    expect(estXlsx(buf)).toBe(true);
  }, 120_000);

  it("Toute la semaine, PDF", async () => {
    const { r, buf } = await ficheGet(`type=commande&tout=1&semaine=${SEMAINE}&format=pdf`);
    expect(r.status).toBe(200);
    expect(estPdf(buf)).toBe(true);
    expect((await pagesDuPdf(buf)).length).toBeGreaterThan(6);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 180_000);

  it("Toute la semaine, Excel", async () => {
    const { r, buf } = await ficheGet(`type=commande&tout=1&semaine=${SEMAINE}&format=excel`);
    expect(r.status).toBe(200);
    expect(estXlsx(buf)).toBe(true);
  }, 120_000);

  it("Tableau de la semaine, PDF", async () => {
    const r = await tableauPdf(new Request(`http://pef.test/stock/journalier/pdf?vue=commande&semaine=${SEMAINE}`));
    expect(r.status).toBe(200);
    const buf = Buffer.from(await r.arrayBuffer());
    expect(estPdf(buf)).toBe(true);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("Tableau de la semaine, Excel", async () => {
    const r = await tableauExcel(new Request(`http://pef.test/stock/journalier/excel?vue=commande&semaine=${SEMAINE}`));
    expect(r.status).toBe(200);
    expect(estXlsx(Buffer.from(await r.arrayBuffer()))).toBe(true);
  }, 120_000);
});

describe("même famille : exports des vues Consommation et Comparaison, et fiches Rapport / Consommation", () => {
  for (const vue of ["conso", "comparaison"]) {
    it(`tableau ${vue} : PDF et Excel`, async () => {
      const p = await tableauPdf(new Request(`http://pef.test/stock/journalier/pdf?vue=${vue}&semaine=${SEMAINE}`));
      expect(p.status).toBe(200);
      expect(estPdf(Buffer.from(await p.arrayBuffer()))).toBe(true);
      const x = await tableauExcel(new Request(`http://pef.test/stock/journalier/excel?vue=${vue}&semaine=${SEMAINE}`));
      expect(x.status).toBe(200);
      expect(estXlsx(Buffer.from(await x.arrayBuffer()))).toBe(true);
    }, 120_000);
  }
  for (const type of ["rapport", "consommation"]) {
    it(`fiche ${type} : PDF et Excel`, async () => {
      const p = await ficheGet(`type=${type}&semaine=${SEMAINE}&format=pdf`);
      expect(p.r.status).toBe(200);
      expect(estPdf(p.buf)).toBe(true);
      const x = await ficheGet(`type=${type}&semaine=${SEMAINE}&format=excel`);
      expect(x.r.status).toBe(200);
      expect(estXlsx(x.buf)).toBe(true);
    }, 120_000);
  }
});
