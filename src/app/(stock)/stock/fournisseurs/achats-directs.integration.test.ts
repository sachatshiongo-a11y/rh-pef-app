import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — les achats DIRECTS de la Liste d'achat
// (`MouvementStock.fournisseurId`) ne se perdent jamais en silence : la fusion de deux fournisseurs
// les reporte ; la suppression d'un fournisseur qui en porte est refusée ; l'annulation d'un import
// ne supprime pas un fournisseur qu'ils référencent.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { fusionnerFournisseurs, supprimerFournisseur } = await import("./actions");
const { annulerImport } = await import("@/lib/import-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 300_000);
afterAll(async () => { await fermer?.(); });

const achatDirect = async (designation: string, fournisseurId: string) => {
  const art = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE" } });
  return prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 3, date: new Date("2026-09-10T00:00:00Z"), origine: "Liste d'achat", fournisseurId } });
};

describe("fusion de fournisseurs", () => {
  it("reporte les achats directs de la source sur la cible, puis supprime la source", async () => {
    const source = await prisma.fournisseur.create({ data: { nom: "Maman Epiphanie (doublon)" } });
    const cible = await prisma.fournisseur.create({ data: { nom: "Maman Épiphanie" } });
    const m = await achatDirect("Manioc", source.id);
    const r = await fusionnerFournisseurs(source.id, cible.id);
    expect(r).toBeUndefined();
    expect((await prisma.mouvementStock.findUniqueOrThrow({ where: { id: m.id } })).fournisseurId).toBe(cible.id);
    expect(await prisma.fournisseur.count({ where: { id: source.id } })).toBe(0);
  });
});

describe("suppression d'un fournisseur", () => {
  it("refusée (message renvoyé) s'il porte des achats directs ; rien n'est détaché", async () => {
    const f = await prisma.fournisseur.create({ data: { nom: "Papa Jonas" } });
    const m = await achatDirect("Oignons", f.id);
    await achatDirect("Tomates", f.id);
    const r = await supprimerFournisseur(f.id);
    expect(r).toEqual({ erreur: "Suppression impossible : 2 achat(s) direct(s) de la Liste d'achat sont rattachés à « Papa Jonas ». Fusionnez-le plutôt avec un autre fournisseur, qui reprendra ces achats." });
    expect(await prisma.fournisseur.count({ where: { id: f.id } })).toBe(1);
    expect((await prisma.mouvementStock.findUniqueOrThrow({ where: { id: m.id } })).fournisseurId).toBe(f.id);
  });

  it("acceptée sans achat direct", async () => {
    const f = await prisma.fournisseur.create({ data: { nom: "Sans achat" } });
    expect(await supprimerFournisseur(f.id)).toBeUndefined();
    expect(await prisma.fournisseur.count({ where: { id: f.id } })).toBe(0);
  });
});

describe("annulation d'un import", () => {
  it("garde un fournisseur créé par l'import s'il porte des achats directs", async () => {
    const f = await prisma.fournisseur.create({ data: { nom: "Créé par import" } });
    const libre = await prisma.fournisseur.create({ data: { nom: "Créé par import, jamais utilisé" } });
    const m = await achatDirect("Riz", f.id);
    const batch = await prisma.importBatch.create({
      data: { type: "FACTURES", libelle: "Import test", operations: { create: [
        { entite: "Fournisseur", entiteId: f.id, action: "CREATE" },
        { entite: "Fournisseur", entiteId: libre.id, action: "CREATE" },
      ] } },
    });
    await annulerImport(batch.id);
    expect(await prisma.fournisseur.count({ where: { id: f.id } })).toBe(1);
    expect((await prisma.mouvementStock.findUniqueOrThrow({ where: { id: m.id } })).fournisseurId).toBe(f.id);
    expect(await prisma.fournisseur.count({ where: { id: libre.id } })).toBe(0);
  });
});
