import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : prix de référence d'un article en FRANCS
// (demande de la Direction, 2026-10-08). Vraies actions serveur du catalogue et de « Demandes à
// valider ». La devise de saisie fait foi : un prix saisi en francs est enregistré en francs, jamais
// converti ; changer de devise efface l'ancien prix ; hors Direction, c'est une PROPOSITION dont
// l'avant → après montre la devise.
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
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const C = await import("./actions");
const { validerDemandes } = await import("../a-valider/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const v = async (ids: string[]) => Object.fromEntries((await prisma.demandeValidationStock.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"]] as const) {
    U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } })).id;
  }
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(o)) f.set(k, x); return f; };
const article = async (designation: string, prix: { usd?: string; cdf?: string }) => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Kg", devisePrix: prix.cdf ? "CDF" : "USD", prixUnitaireUSD: prix.usd ?? null, prixUnitaireCDF: prix.cdf ?? null } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: 10 } });
  return a.id;
};
const prix = async (id: string) => {
  const a = await prisma.articleStock.findUniqueOrThrow({ where: { id } });
  return { devise: a.devisePrix, usd: a.prixUnitaireUSD?.toString() ?? null, cdf: a.prixUnitaireCDF?.toString() ?? null };
};

describe("prix d'article en francs — saisie", () => {
  it("création en FC : enregistré en francs, sans dollars ; création sans devise = dollars comme avant", async () => {
    en("dir");
    await C.creerArticle(fd({ designation: "Manioc", domaine: "NOURRITURE", devisePrix: "CDF", prixUnitaireCDF: "7 000" }));
    await C.creerArticle(fd({ designation: "Riz", domaine: "NOURRITURE", prixUnitaireUSD: "2,5" }));
    const m = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Manioc" } });
    const r = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Riz" } });
    expect(await prix(m.id)).toEqual({ devise: "CDF", usd: null, cdf: "7000" });
    expect(await prix(r.id)).toEqual({ devise: "USD", usd: "2.5", cdf: null });
  }, 60_000);

  it("Direction : passer un article de $ à FC efface le prix en dollars (jamais converti en silence)", async () => {
    en("dir");
    const riz = await article("Riz", { usd: "2.5" });
    await C.modifierArticle(riz, fd({ devisePrix: "CDF", prixUnitaireCDF: "7 125" }));
    expect(await prix(riz)).toEqual({ devise: "CDF", usd: null, cdf: "7125" });
    // Retour en $ : le prix en francs s'efface à son tour.
    await C.modifierArticle(riz, fd({ devisePrix: "USD", prixUnitaireUSD: "2,4" }));
    expect(await prix(riz)).toEqual({ devise: "USD", usd: "2.4", cdf: null });
  }, 60_000);

  it("case de l'Inventaire : le prix d'un article en FC se saisit en FC ; un prix en $ est refusé, rien n'est écrit", async () => {
    en("dir");
    const manioc = await article("Manioc", { cdf: "7000" });
    await C.modifierArticle(manioc, fd({ prixUnitaireCDF: "7 500" }));
    expect(await prix(manioc)).toEqual({ devise: "CDF", usd: null, cdf: "7500" });
    expect(await C.modifierArticle(manioc, fd({ prixUnitaireUSD: "3" }))).toMatchObject({ erreur: expect.stringMatching(/prix en francs/) });
    expect(await prix(manioc)).toEqual({ devise: "CDF", usd: null, cdf: "7500" });
    expect(await C.modifierArticle(manioc, fd({ devisePrix: "EUR", prixUnitaireCDF: "1" }))).toMatchObject({ erreur: expect.stringMatching(/Devise du prix inconnue/) });
  }, 60_000);

  it("hors Direction : une PROPOSITION dont l'avant → après montre la devise ; validée, l'article passe en FC", async () => {
    const riz = await article("Riz", { usd: "2.5" });
    en("resp");
    expect(await C.modifierArticle(riz, fd({ devisePrix: "CDF", prixUnitaireCDF: "7 000" }))).toMatchObject({ proposition: true });
    expect(await prix(riz)).toEqual({ devise: "USD", usd: "2.5", cdf: null }); // rien ne change avant validation
    const [d] = await prisma.demandeValidationStock.findMany();
    const ch = (d.charge as { articles: { changements: { champ: string; avantLibelle: string; apresLibelle: string }[] }[] }).articles[0].changements;
    expect(Object.fromEntries(ch.map((c) => [c.champ, `${c.avantLibelle} → ${c.apresLibelle}`]))).toEqual({
      devisePrix: "dollars ($) → francs (FC)", prixUnitaireUSD: "2,5 → —", prixUnitaireCDF: "— → 7000",
    });
    expect(d.resume).toBe("« Riz » : Devise du prix, Prix unitaire USD, Prix unitaire FC");
    en("dir");
    await validerDemandes([d.id], {}, await v([d.id]));
    expect(await prix(riz)).toEqual({ devise: "CDF", usd: null, cdf: "7000" });
  }, 60_000);

  it("hors Direction : changer le prix en FC d'un article en FC ne propose que ce prix", async () => {
    const manioc = await article("Manioc", { cdf: "7000" });
    en("resp");
    await C.modifierArticle(manioc, fd({ devisePrix: "CDF", prixUnitaireCDF: "7 200" }));
    const [d] = await prisma.demandeValidationStock.findMany();
    expect(d.resume).toBe("« Manioc » : Prix unitaire FC 7000 → 7200");
  }, 60_000);

  it("proposition périmée : la Direction a changé la devise entre-temps → conflit, rien n'est écrit", async () => {
    const riz = await article("Riz", { usd: "2.5" });
    en("resp");
    await C.modifierArticle(riz, fd({ prixUnitaireUSD: "3" }));
    const [d] = await prisma.demandeValidationStock.findMany();
    en("dir");
    await C.modifierArticle(riz, fd({ devisePrix: "CDF", prixUnitaireCDF: "7000" }));
    const r = await validerDemandes([d.id], {}, await v([d.id]));
    expect(JSON.stringify(r)).toMatch(/Prix unitaire USD a changé depuis la proposition/);
    expect(await prix(riz)).toEqual({ devise: "CDF", usd: null, cdf: "7000" });
  }, 60_000);
});
