import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Rattachement « article du restaurant → article du catalogue » : toujours un geste, jamais une
// déduction ; seules les cases cochées sont écrites ; chaque changement est journalisé. Un article du
// restaurant peut être rattaché à PLUSIEURS articles du catalogue (plusieurs marques de beurre).
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

const { ajouterLiensResto, retirerLiensResto, accepterPropositions } = await import("./actions");

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
  await prisma.articleRestoStock.deleteMany();
  await prisma.articleResto.deleteMany();
  await prisma.articleStock.deleteMany();
});

const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error("Action acceptée alors qu'elle aurait dû être refusée.");
};
const article = (designation: string, actif = true) => prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", actif } });
const resto = (designation: string) => prisma.articleResto.create({ data: { espace: "CUISINE", designation, unite: "kg" } });
/** L'article du catalogue rattaché s'il n'y en a qu'un (null : aucun) ; la liste complète via `rattaches`. */
const rattaches = async (id: string) => (await prisma.articleRestoStock.findMany({ where: { articleRestoId: id }, orderBy: { createdAt: "asc" } })).map((l) => l.articleStockId);
const rattache = async (id: string) => (await rattaches(id))[0] ?? null;

describe("rattachement au catalogue", () => {
  it("un rattachement n'est jamais créé sans action : ouvrir la page Restaurant n'écrit rien", async () => {
    await article("Beurre");
    await resto("Beurre");
    const { default: RestaurantPage } = await import("./page");
    await RestaurantPage({ searchParams: Promise.resolve({}) });
    expect(await prisma.articleRestoStock.count()).toBe(0);
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
      [["ArticleResto", rb.id, "lien article du catalogue", null, "Beurre"], ["ArticleResto", rf.id, "lien article du catalogue", null, "Farine"]].sort(),
    );
  }, 60_000);

  it("une case cochée qui n'est pas (ou plus) une proposition n'est pas écrite", async () => {
    await article("Tomate");
    const rc = await resto("Tomates"); // pluriel : jamais proposé (les accents, eux, ne séparent plus — 2026-10-08)
    expect(erreurDe(await accepterPropositions([rc.id]))).toContain("Aucune des lignes cochées");
    expect(await rattache(rc.id)).toBeNull();
    expect(erreurDe(await accepterPropositions([]))).toContain("Cochez au moins une proposition");
  }, 60_000);

  it("une proposition faite par le NOM COURT du catalogue s'accepte (même clé à l'écran et au serveur)", async () => {
    const agneau = await prisma.articleStock.create({ data: { designation: "AGNEAU CARRE FRANCE 1KG", nomCourt: "Carré d'agneau", domaine: "NOURRITURE", unite: "kg" } });
    const r = await resto("Carre d'agneau");
    expect(await accepterPropositions([r.id])).toEqual({ n: 1, ignores: 0 });
    expect(await rattache(r.id)).toBe(agneau.id);
  }, 60_000);

  it("rattacher PLUSIEURS marques, en retirer une : chaque ajout et chaque retrait est au journal, rien n'est écrit pour un lien déjà posé", async () => {
    const [p, l, v] = await Promise.all([article("Beurre Président 250 g"), article("Beurre Lurpak 500 g"), article("Beurre Vache qui rit")]);
    const r = await resto("Beurre");
    expect(await ajouterLiensResto(r.id, [p.id])).toEqual({ n: 1 });
    expect(await ajouterLiensResto(r.id, [p.id])).toEqual({ n: 0 }); // déjà rattaché : rien d'écrit
    expect(await ajouterLiensResto(r.id, [l.id, v.id, p.id])).toEqual({ n: 2 }); // un lot
    expect(await rattaches(r.id)).toHaveLength(3);
    expect(await retirerLiensResto(r.id, [l.id])).toEqual({ n: 1 });
    expect(await retirerLiensResto(r.id, [l.id])).toEqual({ n: 0 }); // déjà retiré
    expect((await rattaches(r.id)).sort()).toEqual([p.id, v.id].sort());
    const journal = await prisma.journalAudit.findMany({ where: { entiteId: r.id } });
    expect(journal.map((j) => `${j.ancienneValeur}→${j.nouvelleValeur}`).sort()).toEqual(
      ["null→Beurre Président 250 g", "null→Beurre Lurpak 500 g", "null→Beurre Vache qui rit", "Beurre Lurpak 500 g→null"].sort(),
    );
    expect(journal.every((j) => j.champ === "lien article du catalogue")).toBe(true);
  }, 60_000);

  it("un article du catalogue déjà rattaché à un AUTRE article du restaurant du même espace est refusé, nommément ; un autre espace passe", async () => {
    const beurre = await article("Beurre Président");
    const r1 = await resto("Beurre");
    const r2 = await resto("Beurre de cuisson");
    const bar = await prisma.articleResto.create({ data: { espace: "BAR", designation: "Beurre (bar)", unite: "kg" } });
    expect(await ajouterLiensResto(r1.id, [beurre.id])).toEqual({ n: 1 });
    const e = erreurDe(await ajouterLiensResto(r2.id, [beurre.id]));
    expect(e).toContain("« Beurre Président » est déjà rattaché à « Beurre » (Cuisine)");
    expect(e).toContain("Rien n'a été rattaché");
    expect(await rattaches(r2.id)).toEqual([]);
    expect(await ajouterLiensResto(bar.id, [beurre.id])).toEqual({ n: 1 }); // Cuisine et Bar : l'espace se lit au domaine
  }, 60_000);

  it("Direction : une proposition d'unité DIFFÉRENTE de l'Inventaire, cochée à la main, n'est pas écrite (une seule unité par produit)", async () => {
    await prisma.articleStock.create({ data: { designation: "Farine T55", domaine: "NOURRITURE", unite: "g" } });
    const r = await resto("Farine T55"); // kg au restaurant, g à l'Inventaire
    const e = erreurDe(await accepterPropositions([r.id]));
    expect(e).toContain("alignez l'unité dans l'Inventaire d'abord");
    expect(await rattaches(r.id)).toEqual([]);
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it("retirer un article du catalogue du lien fait retomber la proposition : l'article du restaurant sans lien redevient proposable", async () => {
    const beurre = await article("Beurre");
    const r = await resto("Beurre");
    await ajouterLiensResto(r.id, [beurre.id]);
    expect(erreurDe(await accepterPropositions([r.id]))).toContain("Aucune des lignes cochées"); // déjà rattaché
    await retirerLiensResto(r.id, [beurre.id]);
    expect(await accepterPropositions([r.id])).toEqual({ n: 1, ignores: 0 });
  }, 60_000);

  it("refuse un article du catalogue désactivé, par un message lisible", async () => {
    const vieux = await article("Margarine", false);
    const r = await resto("Margarine");
    expect(erreurDe(await ajouterLiensResto(r.id, [vieux.id]))).toContain("désactivé");
    expect(await rattache(r.id)).toBeNull();
  }, 60_000);
});
