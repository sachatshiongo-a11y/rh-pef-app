import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { creerBaseTest } from "@/lib/test/db";

// Import d'inventaire (audit du 10/10/2026, constat 12) :
//  - le rapprochement par nom APPROCHANT n'est plus appliqué d'office (confirmation par ligne) ;
//  - la clôture est contrôlée (mouvements du journal, achats de légumes) ;
//  - plus de taux 2300 en dur pour les légumes : taux des Paramètres, sinon montant laissé en francs.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { appliquerInventaire, analyserInventaire } = await import("@/lib/import-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  userId = (await prisma.user.create({ data: { email: "direction@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.importOperation.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.achatLegume.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.clotureStock.deleteMany();
  await prisma.config.deleteMany();
});

type Ligne = { code: string; nom: string; sinit: number; journal?: { date: Date; entree?: number; sortie?: number }[] };
/** Classeur minimal : feuille « Nourriture » (colonnes du vrai classeur) et, si demandé, « Légumes frais ». */
async function classeur(lignes: Ligne[], legumes: { date: Date; nom: string; qte: number; cdf: number }[] = []): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nourriture");
  let r = 13;
  lignes.forEach((l, i) => {
    const row = ws.getRow(13 + i);
    row.getCell(1).value = l.code; row.getCell(2).value = l.nom; row.getCell(3).value = "Kg"; row.getCell(6).value = l.sinit;
    row.commit();
  });
  for (const l of lignes) for (const j of l.journal ?? []) {
    const row = ws.getRow(r++);
    row.getCell(17).value = j.date; row.getCell(18).value = l.code; row.getCell(22).value = j.entree ?? 0; row.getCell(23).value = j.sortie ?? 0;
    row.commit();
  }
  if (legumes.length > 0) {
    const wl = wb.addWorksheet("Légumes frais");
    legumes.forEach((l, i) => {
      const row = wl.getRow(12 + i);
      row.getCell(11).value = l.date; row.getCell(13).value = l.nom; row.getCell(14).value = l.qte; row.getCell(15).value = l.cdf;
      row.commit();
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("rapprochement par nom approchant : jamais d'office", () => {
  it("« Farine blé T55 » n'est pas rapproché de « Farine de blé » : proposé, sans choix rien n'est importé", async () => {
    const farine = (await prisma.articleStock.create({ data: { designation: "Farine de blé", domaine: "NOURRITURE", stock: { create: { quantite: 3 } } } })).id;
    const buf = await classeur([{ code: "801", nom: "Farine blé T55", sinit: 9 }]);
    const p = await analyserInventaire(buf);
    expect(p.articles[0]).toMatchObject({ match: "aucun", articleId: null, approxId: farine, creationPossible: true });
    expect(p.articles[0].proches?.[0]).toMatchObject({ id: farine, designation: "Farine de blé" });

    await expect(appliquerInventaire(buf, "Inv", userId)).rejects.toThrow("« Farine blé T55 » → « Farine de blé »");
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: farine } })).quantite)).toBe(3); // intact
    expect(await prisma.articleStock.count()).toBe(1);
  }, 60_000);

  it("« Utiliser » pose le stock sur l'article choisi", async () => {
    const farine = (await prisma.articleStock.create({ data: { designation: "Farine de blé", domaine: "NOURRITURE", stock: { create: { quantite: 3 } } } })).id;
    await appliquerInventaire(await classeur([{ code: "801", nom: "Farine blé T55", sinit: 7 }]), "Inv B", userId, { choixArticles: { "NOURRITURE|801": farine } });
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: farine } })).quantite)).toBe(7);
    expect(await prisma.articleStock.count()).toBe(1);
  }, 60_000);

  it("« Créer » en fait un nouvel article sans toucher l'existant", async () => {
    const farine = (await prisma.articleStock.create({ data: { designation: "Farine de blé", domaine: "NOURRITURE", stock: { create: { quantite: 3 } } } })).id;
    await appliquerInventaire(await classeur([{ code: "801", nom: "Farine blé T55", sinit: 9 }]), "Inv A", userId, { choixArticles: { "NOURRITURE|801": "CREER" } });
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: farine } })).quantite)).toBe(3);
    expect(await prisma.articleStock.count({ where: { designation: "Farine blé T55" } })).toBe(1);
  }, 60_000);

  it("un nom IDENTIQUE (casse, accents) reste rapproché d'office", async () => {
    const f = (await prisma.articleStock.create({ data: { designation: "Crème fraîche", domaine: "NOURRITURE", stock: { create: { quantite: 1 } } } })).id;
    const p = await analyserInventaire(await classeur([{ code: "802", nom: "CREME FRAICHE", sinit: 2 }]));
    expect(p.articles[0]).toMatchObject({ match: "nom", articleId: f });
  }, 60_000);
});

describe("clôture", () => {
  it("un journal daté d'un mois clôturé : l'aperçu le dit, l'application est refusée sans rien écrire", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    const buf = await classeur([{ code: "803", nom: "Sucre", sinit: 5, journal: [{ date: new Date("2026-08-12"), entree: 2 }, { date: new Date("2026-10-02"), sortie: 1 }] }]);
    const p = await analyserInventaire(buf);
    expect(p.periodeFigee).toEqual({ periode: "08/2026", nbMouvements: 1, nbLegumes: 0 });
    await expect(appliquerInventaire(buf, "Inv", userId)).rejects.toThrow(/clôturée/i);
    expect(await prisma.articleStock.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
  }, 60_000);

  it("un achat de légumes daté d'un mois clôturé est refusé aussi", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    const buf = await classeur([{ code: "804", nom: "Sel", sinit: 1 }], [{ date: new Date("2026-08-05"), nom: "Tomate", qte: 3, cdf: 15000 }]);
    expect((await analyserInventaire(buf)).periodeFigee).toMatchObject({ nbLegumes: 1 });
    await expect(appliquerInventaire(buf, "Inv", userId)).rejects.toThrow(/clôturée/i);
    expect(await prisma.achatLegume.count()).toBe(0);
  }, 60_000);

  it("mois ouvert : l'import passe", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    const buf = await classeur([{ code: "805", nom: "Poivre", sinit: 5, journal: [{ date: new Date("2026-10-02"), entree: 2 }] }]);
    expect((await analyserInventaire(buf)).periodeFigee).toBeNull();
    await appliquerInventaire(buf, "Inv", userId);
    expect(await prisma.mouvementStock.count()).toBe(1);
  }, 60_000);
});

describe("légumes : plus de taux 2300 en dur", () => {
  const leg = [{ date: new Date("2026-10-05"), nom: "Tomate", qte: 3, cdf: 28000 }];
  it("taux des Paramètres appliqué (2 800) : équivalent en dollars et taux figés sur l'achat", async () => {
    await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
    const buf = await classeur([{ code: "806", nom: "Basilic", sinit: 1 }], leg);
    expect((await analyserInventaire(buf)).tauxLegumes).toBe(2800);
    await appliquerInventaire(buf, "Inv", userId);
    const a = await prisma.achatLegume.findFirstOrThrow();
    expect([Number(a.montantCDF), Number(a.montantUSD), Number(a.tauxChangeUtilise)]).toEqual([28000, 10, 2800]); // 28 000 / 2 800 (et non / 2 300 = 12,17)
  }, 60_000);

  it("aucun taux défini : montant laissé en francs, dollar vide, taux vide — aucune conversion inventée", async () => {
    const buf = await classeur([{ code: "807", nom: "Menthe", sinit: 1 }], leg);
    expect((await analyserInventaire(buf)).tauxLegumes).toBeNull();
    await appliquerInventaire(buf, "Inv", userId);
    const a = await prisma.achatLegume.findFirstOrThrow();
    expect([Number(a.montantCDF), a.montantUSD, a.tauxChangeUtilise]).toEqual([28000, null, null]);
  }, 60_000);
});
