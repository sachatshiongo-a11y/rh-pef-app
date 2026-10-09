import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — « courses » sur le stock (relecture du
// 2026-10-09). Deux suppressions simultanées du même mouvement / de la même facture / d'un même lot
// (deux onglets, double clic) ne doivent reprendre le stock QU'UNE FOIS, et la seconde doit répondre
// « déjà supprimé » sans erreur brute de base. `corrigerStocksNegatifs` ne doit pas écraser une entrée
// simultanée.
//
// Le chevauchement est FORCÉ, pas espéré : une transaction « bloqueuse » tient le verrou de la ligne
// Stock ; les deux actions démarrent pendant ce temps (elles ont toutes deux lu l'objet à supprimer
// avant qu'aucune n'écrive) ; puis le verrou est relâché.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { supprimerMouvement, supprimerMouvementsEnLot } = await import("@/app/(stock)/stock/mouvements/actions");
const { supprimerFacture, supprimerFacturesEnLot } = await import("@/app/(stock)/stock/factures/actions");
const { corrigerStocksNegatifs } = await import("@/app/(stock)/stock/catalogue/actions");
const { entrerEnStockTx } = await import("@/lib/validations-stock/stock-positif");
const { verrouillerStocks } = await import("@/lib/validations-stock/comptage");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const JOUR = new Date("2026-10-09T00:00:00Z");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TENUE = 1500; // durée pendant laquelle le verrou du stock est tenu (les deux actions s'y heurtent)

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Sacha", role: "ADMIN" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.ligneFacture.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

async function article(designation: string, stock: number) {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg" } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: stock } });
  return a.id;
}
const stockDe = async (id: string) => Number((await prisma.stock.findUnique({ where: { articleId: id } }))?.quantite ?? NaN);
const mvt = async (articleId: string, type: "ENTREE" | "SORTIE", quantite: number, factureId?: string) =>
  (await prisma.mouvementStock.create({ data: { articleId, type, quantite, date: JOUR, factureId, origine: "test" } })).id;
const facture = async () => (await prisma.factureFournisseur.create({ data: { fournisseurNom: "Marché", montantUSD: 10, montantRegleUSD: 0, resteAPayerUSD: 10, mois: 10, annee: 2026 } })).id;

/** Tient le verrou des lignes Stock `TENUE` ms pendant que `pendant()` lance ce qu'on veut faire entrer en collision. */
async function toutEnTenantLeVerrou<T>(articleIds: string[], pendant: () => Promise<T>): Promise<T> {
  const bloqueuse = prisma.$transaction(async (tx) => { await verrouillerStocks(tx, articleIds); await pause(TENUE); }, { timeout: 30_000 });
  await pause(150);
  const r = await pendant();
  await bloqueuse;
  return r;
}
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
/** Une réponse « brute » : l'erreur de base de données telle quelle, jamais montrée à la Direction. */
const BRUT = /Record to delete does not exist|P2025|Invalid `|prisma|Unique constraint|deadlock/i;

describe("suppressions simultanées : l'effet sur le stock n'est appliqué qu'une fois", () => {
  it("le MÊME mouvement supprimé deux fois en même temps (SORTIE de 4, stock 6) : stock 10, la seconde dit « déjà supprimé »", async () => {
    const riz = await article("Riz", 6);
    const id = await mvt(riz, "SORTIE", 4);
    const [r1, r2] = await toutEnTenantLeVerrou([riz], () => Promise.all([supprimerMouvement(id), supprimerMouvement(id)]));
    const erreurs = [r1, r2].map(erreurDe).filter((e) => e !== null);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("déjà été supprimé");
    expect(erreurs[0]).not.toMatch(BRUT);
    expect(await stockDe(riz)).toBe(10);
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);

  it("le MÊME lot de mouvements supprimé deux fois : stock repris une fois, la seconde dit « déjà supprimés » sans erreur brute", async () => {
    const riz = await article("Riz", 6);
    const sel = await article("Sel", 1);
    const a = await mvt(riz, "SORTIE", 4);
    const b = await mvt(sel, "SORTIE", 2);
    const [r1, r2] = await toutEnTenantLeVerrou([riz, sel], () => Promise.all([supprimerMouvementsEnLot([a, b]), supprimerMouvementsEnLot([b, a])]));
    const erreurs = [r1, r2].map(erreurDe).filter((e) => e !== null);
    const faits = [r1, r2].filter((r) => erreurDe(r) === null);
    expect(faits).toHaveLength(1);
    expect(faits[0]).toEqual({ n: 2 });
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("déjà été supprimés");
    expect(erreurs[0]).not.toMatch(BRUT);
    expect([await stockDe(riz), await stockDe(sel)]).toEqual([10, 3]);
  }, 60_000);

  it("deux lots qui se CHEVAUCHENT ([a,b] et [b,c]) : chaque mouvement est repris une fois, b n'est pas compté deux fois", async () => {
    const riz = await article("Riz", 0);
    const a = await mvt(riz, "SORTIE", 1);
    const b = await mvt(riz, "SORTIE", 10);
    const c = await mvt(riz, "SORTIE", 100);
    const rs = await toutEnTenantLeVerrou([riz], () => Promise.all([supprimerMouvementsEnLot([a, b]), supprimerMouvementsEnLot([b, c])]));
    expect(rs.map(erreurDe)).toEqual([null, null]);
    // n + dejaSupprimes : b est revenu à l'un des deux lots, pas aux deux.
    const ns = rs.map((r) => (r as { n: number }).n).sort();
    expect(ns).toEqual([1, 2]);
    expect(await stockDe(riz)).toBe(111); // 1 + 10 + 100, une seule fois chacun
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);

  it("la MÊME facture supprimée deux fois (entrée 5, stock 10) : stock 5, la seconde dit « déjà supprimée »", async () => {
    const riz = await article("Riz", 10);
    const f = await facture();
    await mvt(riz, "ENTREE", 5, f);
    const [r1, r2] = await toutEnTenantLeVerrou([riz], () => Promise.all([supprimerFacture(f), supprimerFacture(f)]));
    const erreurs = [r1, r2].map(erreurDe).filter((e) => e !== null);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("déjà été supprimée");
    expect(erreurs[0]).not.toMatch(BRUT);
    expect(await stockDe(riz)).toBe(5);
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);

  it("le MÊME lot de factures supprimé deux fois : stock repris une fois, la seconde dit « déjà supprimées »", async () => {
    const riz = await article("Riz", 20);
    const f1 = await facture(); const f2 = await facture();
    await mvt(riz, "ENTREE", 5, f1); await mvt(riz, "ENTREE", 3, f2);
    const [r1, r2] = await toutEnTenantLeVerrou([riz], () => Promise.all([supprimerFacturesEnLot([f1, f2]), supprimerFacturesEnLot([f2, f1])]));
    const erreurs = [r1, r2].map(erreurDe).filter((e) => e !== null);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("déjà été supprimées");
    expect(erreurs[0]).not.toMatch(BRUT);
    expect([r1, r2].filter((r) => erreurDe(r) === null)[0]).toEqual({ n: 2 });
    expect(await stockDe(riz)).toBe(12);
    expect(await prisma.factureFournisseur.count()).toBe(0);
  }, 60_000);

  it("une facture ET l'une de ses entrées supprimées en même temps : l'entrée n'est reprise qu'une fois (stock 10 → 5)", async () => {
    const riz = await article("Riz", 10);
    const f = await facture();
    const m = await mvt(riz, "ENTREE", 5, f);
    const [r1, r2] = await toutEnTenantLeVerrou([riz], () => Promise.all([supprimerFacture(f), supprimerMouvement(m)]));
    for (const r of [r1, r2]) { const e = erreurDe(r); if (e) { expect(e).toContain("déjà"); expect(e).not.toMatch(BRUT); } }
    expect(await stockDe(riz)).toBe(5);
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
  }, 60_000);

  it("supprimer un mouvement qui n'existe plus : message lisible, pas d'erreur de base", async () => {
    const r = await supprimerMouvement("inexistant");
    expect(erreurDe(r)).toContain("déjà été supprimé");
    expect(erreurDe(r)).not.toMatch(BRUT);
  });
});

describe("corrigerStocksNegatifs et courses", () => {
  it("une ENTRÉE simultanée qui relève le stock (−5 + 8) n'est pas écrasée par la remise à 0 : stock 3, rien à corriger", async () => {
    const riz = await article("Riz", -5);
    const entree = prisma.$transaction(async (tx) => { await entrerEnStockTx(tx, [{ articleId: riz, quantite: 8 }]); await pause(TENUE); }, { timeout: 30_000 });
    await pause(150);
    const r = await corrigerStocksNegatifs([riz]); // lit le stock pendant que l'entrée n'est pas encore validée
    await entree;
    expect(r).toEqual({ corriges: 0 }); // relu sous verrou : 3, plus négatif
    expect(await stockDe(riz)).toBe(3);
    expect(await prisma.mouvementStock.count({ where: { origine: { contains: "Correction" } } })).toBe(0);
  }, 60_000);

  it("une entrée simultanée qui laisse le stock négatif (−5 + 2) : corrigé de 3 (relu sous verrou), pas de 5", async () => {
    const riz = await article("Riz", -5);
    const entree = prisma.$transaction(async (tx) => { await entrerEnStockTx(tx, [{ articleId: riz, quantite: 2 }]); await pause(TENUE); }, { timeout: 30_000 });
    await pause(150);
    const r = await corrigerStocksNegatifs([riz]);
    await entree;
    expect(r).toEqual({ corriges: 1 });
    expect(await stockDe(riz)).toBe(0);
    const corr = await prisma.mouvementStock.findMany({ where: { origine: { contains: "Correction" } } });
    expect(corr.map((c) => Number(c.quantite))).toEqual([3]);
  }, 60_000);

  it("deux corrections simultanées du même stock négatif : une seule écrit, une seule entrée d'ajustement", async () => {
    const riz = await article("Riz", -5);
    const rs = await toutEnTenantLeVerrou([riz], () => Promise.all([corrigerStocksNegatifs([riz]), corrigerStocksNegatifs([riz])]));
    expect(rs.map((r) => (r as { corriges: number }).corriges).sort()).toEqual([0, 1]);
    expect(await stockDe(riz)).toBe(0);
    expect(await prisma.mouvementStock.count({ where: { origine: { contains: "Correction" } } })).toBe(1);
  }, 60_000);
});
