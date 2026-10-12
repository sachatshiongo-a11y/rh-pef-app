import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Supprimer une facture (unitaire ou en lot) reprend le stock de ses entrées DATÉES : un mois clôturé ne
// se réécrit pas en douce (audit du 10/10/2026, constat 4).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { supprimerFacturesTx } = await import("@/lib/validations-stock/suppression-facture");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  articleId = (await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg" } })).id;
  await prisma.stock.create({ data: { articleId, quantite: 30 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

async function factureAvecEntree(dateISO: string, quantite: number) {
  const f = await prisma.factureFournisseur.create({ data: { fournisseurNom: "SENEVE", montantUSD: 10, resteAPayerUSD: 10, mois: Number(dateISO.slice(5, 7)), annee: Number(dateISO.slice(0, 4)), date: new Date(dateISO) } });
  await prisma.mouvementStock.create({ data: { articleId, type: "ENTREE", quantite, date: new Date(dateISO), factureId: f.id, origine: "Facture SENEVE" } });
  return f.id;
}
const supprimer = (ids: string[]) => prisma.$transaction((tx) => supprimerFacturesTx(tx, ids));

describe("supprimerFacturesTx — clôture de stock", () => {
  it("refuse la suppression d'une facture dont les entrées sont d'un mois clôturé : rien n'est écrit", async () => {
    const id = await factureAvecEntree("2026-02-10", 5);
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 2 } });
    await expect(supprimer([id])).rejects.toThrow(/clôturée/i);
    expect(await prisma.factureFournisseur.count({ where: { id } })).toBe(1);
    expect(await prisma.mouvementStock.count({ where: { factureId: id } })).toBe(1);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite)).toBe(30);
  }, 60_000);

  it("en lot : une seule facture d'un mois clôturé refuse TOUT le lot", async () => {
    const figee = await factureAvecEntree("2026-01-15", 2);
    const ouverte = await factureAvecEntree("2026-05-15", 3);
    await expect(supprimer([ouverte, figee])).rejects.toThrow(/clôturée/i);
    expect(await prisma.factureFournisseur.count({ where: { id: { in: [ouverte, figee] } } })).toBe(2);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite)).toBe(30);
  }, 60_000);

  it("une facture d'un mois ouvert se supprime et reprend son stock", async () => {
    const id = await factureAvecEntree("2026-06-10", 4);
    await prisma.stock.update({ where: { articleId }, data: { quantite: 34 } });
    const r = await supprimer([id]);
    expect(r.facs.length).toBe(1);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite)).toBe(30);
  }, 60_000);
});
