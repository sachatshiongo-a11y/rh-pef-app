import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Rattachement « article du restaurant → article du catalogue » : toujours un geste, jamais une
// déduction ; seules les cases cochées sont écrites ; chaque changement est journalisé.
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

const { rattacherArticleResto, accepterPropositions } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "resto@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  await prisma.journalAudit.deleteMany();
  await prisma.articleResto.deleteMany();
  await prisma.articleStock.deleteMany();
});

const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error("Action acceptée alors qu'elle aurait dû être refusée.");
};
const article = (designation: string, actif = true) => prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", actif } });
const resto = (designation: string) => prisma.articleResto.create({ data: { espace: "CUISINE", designation, unite: "kg" } });
const rattache = async (id: string) => (await prisma.articleResto.findUniqueOrThrow({ where: { id } })).articleStockId;

describe("rattachement au catalogue", () => {
  it("un rattachement n'est jamais créé sans action : ouvrir la page Restaurant n'écrit rien", async () => {
    await article("Beurre");
    await resto("Beurre");
    const { default: RestaurantPage } = await import("./page");
    await RestaurantPage({ searchParams: Promise.resolve({}) });
    expect(await prisma.articleResto.count({ where: { articleStockId: { not: null } } })).toBe(0);
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it("l'acceptation groupée n'écrit que les cases cochées, et journalise chacune", async () => {
    const [beurre, sel, farine] = await Promise.all([article("Beurre"), article("Sel"), article("Farine")]);
    const [rb, rs, rf] = await Promise.all([resto("Beurre"), resto("SEL"), resto(" farine ")]);

    const r = await accepterPropositions([rb.id, rf.id]);
    expect(r).toEqual({ n: 2, ignores: 0 });
    expect(await rattache(rb.id)).toBe(beurre.id);
    expect(await rattache(rf.id)).toBe(farine.id);
    expect(await rattache(rs.id)).toBeNull(); // proposée, mais pas cochée
    expect(sel.id).toBeTruthy();

    const journal = await prisma.journalAudit.findMany({ orderBy: { entiteId: "asc" } });
    expect(journal.map((j) => [j.entite, j.entiteId, j.champ, j.ancienneValeur, j.nouvelleValeur]).sort()).toEqual(
      [["ArticleResto", rb.id, "articleStockId", null, beurre.id], ["ArticleResto", rf.id, "articleStockId", null, farine.id]].sort(),
    );
  }, 60_000);

  it("une case cochée qui n'est pas (ou plus) une proposition n'est pas écrite", async () => {
    await article("Crème");
    const rc = await resto("Creme"); // accent différent : jamais proposé
    expect(erreurDe(await accepterPropositions([rc.id]))).toContain("Aucune des lignes cochées");
    expect(await rattache(rc.id)).toBeNull();
    expect(erreurDe(await accepterPropositions([]))).toContain("Cochez au moins une proposition");
  }, 60_000);

  it("rattacher, changer, détacher : trois gestes, trois entrées au journal", async () => {
    const [a1, a2] = await Promise.all([article("Huile"), article("Huile de palme")]);
    const r = await resto("Huile rouge");
    expect(await rattacherArticleResto(r.id, a1.id)).toEqual({ n: 1 });
    expect(await rattacherArticleResto(r.id, a1.id)).toEqual({ n: 0 }); // inchangé : rien d'écrit
    expect(await rattacherArticleResto(r.id, a2.id)).toEqual({ n: 1 });
    expect(await rattacherArticleResto(r.id, null)).toEqual({ n: 1 });
    expect(await rattache(r.id)).toBeNull();
    const journal = await prisma.journalAudit.findMany({ where: { entiteId: r.id } });
    expect(journal.map((j) => `${j.ancienneValeur}→${j.nouvelleValeur}`).sort()).toEqual(
      [`null→${a1.id}`, `${a1.id}→${a2.id}`, `${a2.id}→null`].sort(),
    );
  }, 60_000);

  it("refuse un article du catalogue désactivé, par un message lisible", async () => {
    const vieux = await article("Margarine", false);
    const r = await resto("Margarine");
    expect(erreurDe(await rattacherArticleResto(r.id, vieux.id))).toContain("désactivé");
    expect(await rattache(r.id)).toBeNull();
  }, 60_000);
});
