import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Tests d'INTÉGRATION (Postgres éphémère, jamais la prod) : import CSV d'entrées/sorties, son
// annulation réversible, et le refus d'écrire dans un mois clôturé.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { appliquerMouvements, analyserMouvements } = await import("@/lib/import-mouvements");
const { annulerImport } = await import("@/lib/import-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;
let userId: string;

const CSV = "Date,Code article,Désignation,Entrées,Sorties\n10/07/2026,3,Riz basmati 5kg,5,2";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "Testeur", role: "ADMIN" } });
  userId = u.id;
  const art = await prisma.articleStock.create({ data: { code: "3", designation: "Riz basmati 5kg", domaine: "NOURRITURE", unite: "Sac" } });
  articleId = art.id;
  await prisma.stock.create({ data: { articleId, quantite: 10, stockMinimum: 4 } });

  // Rapprochement : les codes se dupliquent entre catalogues (chaque domaine a sa numérotation).
  await prisma.articleStock.createMany({
    data: [
      { code: "100", designation: "Limoncello", domaine: "BOISSON", unite: "Bouteille" },
      { code: "999", designation: "Couteaux en plastique", domaine: "AUTRE", unite: "Paquet" },
      { code: "55", designation: "Coca Cola-30cl", domaine: "BOISSON", unite: "Bouteille" },
      { code: "55", designation: "Portions filet de boeuf", domaine: "NOURRITURE", unite: "Portion" },
    ],
  });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("appliquerMouvements — import CSV + annulation réversible", () => {
  it("crée les mouvements (entrée + sortie) et ajuste le stock du net", async () => {
    const { batchId, resume } = await appliquerMouvements(CSV, "Import test", "2026-07-10", userId);
    expect(resume.rapprochees).toBe(1);

    const mvts = await prisma.mouvementStock.findMany({ where: { articleId }, orderBy: { type: "asc" } });
    expect(mvts.map((m) => m.type).sort()).toEqual(["ENTREE", "SORTIE"]);
    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(stock.quantite)).toBe(13); // 10 + 5 − 2

    // ImportBatch réversible enregistré.
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { operations: true } });
    expect(batch.operations.length).toBeGreaterThanOrEqual(3); // 1 Stock (avant) + 2 mouvements

    // Annulation : supprime les mouvements et restaure le stock exact.
    await annulerImport(batchId);
    expect(await prisma.mouvementStock.count({ where: { articleId } })).toBe(0);
    const restaure = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(restaure.quantite)).toBe(10);
  }, 60_000);

  it("refuse d'importer dans un mois clôturé", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 7, creeParId: userId } });
    await expect(appliquerMouvements(CSV, "Import test 2", "2026-07-10", userId)).rejects.toThrow(/clôturée/i);
    // Aucune écriture : le stock est resté à 10 (restauré au test précédent).
    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(stock.quantite)).toBe(10);
  }, 60_000);
});

describe("annulerImport — un article créé puis mis dans une fiche technique", () => {
  it("refuse l'annulation en nommant l'article ET la fiche, sans rien annuler à moitié", async () => {
    // `IngredientFiche.articleId` est en `onDelete: Restrict` : supprimer l'article créé par
    // l'import violerait la contrainte (message Postgres brut) et ferait échouer TOUTE
    // l'annulation. On l'annonce d'abord, en français, et on ne touche à rien.
    const cree = await prisma.articleStock.create({ data: { designation: "Câpres au vinaigre", domaine: "NOURRITURE" } });
    const batch = await prisma.importBatch.create({ data: { type: "INVENTAIRE", libelle: "Inventaire test" } });
    await prisma.importOperation.create({
      data: { batchId: batch.id, entite: "ArticleStock", entiteId: cree.id, action: "CREATE" },
    });
    const fiche = await prisma.ficheTechnique.create({ data: { nom: "Filet de saumon au beurre blanc", nbPortions: 4 } });
    const ingredient = await prisma.ingredientFiche.create({
      data: { ficheId: fiche.id, articleId: cree.id, unite: "g", quantite: 15 },
    });

    await expect(annulerImport(batch.id)).rejects.toThrow(/Câpres au vinaigre[\s\S]*Filet de saumon au beurre blanc/);
    // Rien n'a bougé : l'article est toujours là, l'import n'est PAS marqué annulé.
    expect(await prisma.articleStock.findUnique({ where: { id: cree.id } })).not.toBeNull();
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).statut).toBe("APPLIQUE");

    // La ligne de fiche retirée, l'annulation redevient possible et supprime bien l'article.
    await prisma.ingredientFiche.delete({ where: { id: ingredient.id } });
    await annulerImport(batch.id);
    expect(await prisma.articleStock.findUnique({ where: { id: cree.id } })).toBeNull();
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).statut).toBe("ANNULE");
  }, 60_000);
});

describe("analyserMouvements — la désignation prime, codes en collision départagés", () => {
  const entete = "Date,Code article,Désignation,Entrées,Sorties\n";

  it("la désignation exacte prime sur un code qui pointe ailleurs (codes renumérotés)", async () => {
    // Cas réel : « 100 Couteaux en Plastique » était rapproché de « Limoncello » (code 100).
    const p = await analyserMouvements(entete + "10/07/2026,100,Couteaux en Plastique,0,5");
    expect(p.lignes[0].articleNom).toBe("Couteaux en plastique");
    expect(p.lignes[0].rapprochement).toBe("nom");
  }, 60_000);

  it("code en collision entre domaines : départagé par la similarité de nom, jamais au hasard", async () => {
    // « 55 » = Coca (boissons) ET filet de boeuf (nourriture) → le nom tranche.
    const p = await analyserMouvements(entete + "10/07/2026,55,Coca 30CL,0,5");
    expect(p.lignes[0].articleNom).toBe("Coca Cola-30cl");
    expect(p.lignes[0].rapprochement).toBe("code");
  }, 60_000);

  it("code unique au catalogue : rapproche même sans désignation proche", async () => {
    const p = await analyserMouvements(entete + "10/07/2026,3,Zzz mystere,1,0");
    expect(p.lignes[0].articleNom).toBe("Riz basmati 5kg");
    expect(p.lignes[0].rapprochement).toBe("code");
  }, 60_000);
});
