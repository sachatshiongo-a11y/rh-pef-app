import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { creerBaseTest } from "@/lib/test/db";

// Tests d'INTÉGRATION (Postgres éphémère, jamais la prod) — import d'inventaire, 2026-10-09 :
//  1. anti-doublon : un article du classeur qui serait CRÉÉ mais ressemble à un article du catalogue
//     attend « Utiliser … » ou « Créer quand même » (règle de lib/article-proche.ts) ;
//  2. un stock ne passe jamais sous 0 : un stock final négatif dans le classeur est refusé.
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
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

/** Classeur d'inventaire minimal (feuille « Nourriture », colonnes du vrai classeur). */
async function classeur(lignes: { code: string; nom: string; sinit: number }[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nourriture");
  lignes.forEach((l, i) => {
    const row = ws.getRow(13 + i);
    row.getCell(1).value = l.code; row.getCell(2).value = l.nom; row.getCell(3).value = "Kg"; row.getCell(6).value = l.sinit;
    row.commit();
  });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("import d'inventaire — anti-doublon d'article", () => {
  it("l'aperçu nomme les proches ; sans choix rien n'est importé ; « Utiliser » pose le stock sur l'article existant", async () => {
    const tomates = (await prisma.articleStock.create({ data: { designation: "Tomates", domaine: "NOURRITURE", stock: { create: { quantite: 1 } } } })).id;
    const buf = await classeur([{ code: "901", nom: "Tomate", sinit: 4 }, { code: "902", nom: "Gingembre frais", sinit: 2 }]);
    const p = await analyserInventaire(buf);
    const tomate = p.articles.find((a) => a.nom === "Tomate")!;
    expect(tomate).toMatchObject({ match: "aucun", creationPossible: true, proches: [{ id: tomates, designation: "Tomates" }] });
    expect(p.articles.find((a) => a.nom === "Gingembre frais")!.proches).toBeUndefined();

    await expect(appliquerInventaire(buf, "Inv", userId)).rejects.toThrow("« Tomate » → « Tomates »");
    expect(await prisma.articleStock.count()).toBe(1);

    const r = await appliquerInventaire(buf, "Inv", userId, { choixArticles: { "NOURRITURE|901": tomates } });
    expect(r.resume).toMatchObject({ maj: 1, crees: 1 });
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: tomates } })).quantite)).toBe(4);
    expect(await prisma.articleStock.count({ where: { designation: "Tomate" } })).toBe(0);
  });

  it("« Créer quand même » crée ; un choix étranger aux proches ne vaut rien", async () => {
    await prisma.articleStock.create({ data: { designation: "Tomates", domaine: "NOURRITURE" } });
    const autre = (await prisma.articleStock.create({ data: { designation: "Sel", domaine: "NOURRITURE" } })).id;
    const buf = await classeur([{ code: "901", nom: "Tomate", sinit: 4 }]);
    await expect(appliquerInventaire(buf, "Inv", userId, { choixArticles: { "NOURRITURE|901": autre } })).rejects.toThrow("choisissez « Utiliser … » ou « Créer quand même »");
    await appliquerInventaire(buf, "Inv", userId, { choixArticles: { "NOURRITURE|901": "CREER" } });
    expect(await prisma.articleStock.count({ where: { designation: "Tomate" } })).toBe(1);
  });
});

describe("import d'inventaire — un stock final négatif est refusé", () => {
  it("stock final −2 au classeur : refus nommé, rien n'est importé", async () => {
    const buf = await classeur([{ code: "903", nom: "Poivre noir", sinit: -2 }]);
    await expect(appliquerInventaire(buf, "Inv", userId)).rejects.toThrow("Quantité négative refusée (stock final du classeur) — un stock ne passe jamais sous 0 : Poivre noir (-2 Kg)");
    expect(await prisma.articleStock.count()).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
  });
});
