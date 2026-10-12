import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

/**
 * Rattacher ET détacher une marque d'un article du restaurant (décision de la Direction, 2026-10-12 :
 * « les autres rôles modifient, la Direction valide ») sur une VRAIE base : la Direction écrit tout de
 * suite ; un compte Stock dépose une demande « À valider » (rien n'est écrit) ; la Direction l'approuve
 * (lien posé / retiré, journalisé), la refuse (motif), ou la trouve périmée (rien n'est écrit).
 */
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
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { ajouterLiensResto, retirerLiensResto, accepterPropositions } = await import("./actions");
const { validerDemandes, refuserDemandes } = await import("../a-valider/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const ids: Record<string, string> = {};

const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error(`Acceptée alors qu'elle aurait dû être refusée : ${JSON.stringify(r)}`);
};
const liens = async () => (await prisma.articleRestoStock.findMany({ where: { articleRestoId: ids.beurre }, orderBy: { createdAt: "asc" } })).map((l) => l.articleStockId);
const demandes = () => prisma.demandeValidationStock.findMany({ where: { nature: "LIEN_RESTO" }, orderBy: { createdAt: "asc" } });
const version = async (id: string) => (await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
const journal = () => prisma.journalAudit.findMany({ where: { entite: "ArticleResto", entiteId: ids.beurre }, orderBy: { date: "asc" }, select: { champ: true, ancienneValeur: true, nouvelleValeur: true, userId: true } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"]] as const) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } })).id;
  const marque = (designation: string) => prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg" } });
  ids.president = (await marque("Beurre Président")).id;
  ids.lurpak = (await marque("Beurre Lurpak")).id;
  ids.vache = (await marque("Beurre Vache qui rit")).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.articleRestoStock.deleteMany();
  await prisma.articleResto.deleteMany();
  ids.beurre = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Beurre", unite: "kg" } })).id;
  en("dir");
});

describe("Direction : écriture directe, aucune demande", () => {
  it("rattacher puis détacher une marque : fait tout de suite, journalisé, sans demande", async () => {
    expect(await ajouterLiensResto(ids.beurre!, [ids.president!, ids.lurpak!])).toEqual({ n: 2 });
    expect(await liens()).toHaveLength(2);
    expect(await retirerLiensResto(ids.beurre!, [ids.lurpak!])).toEqual({ n: 1 });
    expect(await liens()).toEqual([ids.president]);
    expect(await demandes()).toEqual([]);
    expect((await journal()).map((j) => [j.ancienneValeur, j.nouvelleValeur, j.userId])).toEqual([
      [null, "Beurre Président", U.dir.id], [null, "Beurre Lurpak", U.dir.id], ["Beurre Lurpak", null, U.dir.id],
    ]);
  });
});

describe("compte Stock : une demande, rien n'est appliqué", () => {
  it("rattacher : demande « À valider », le lien n'existe pas, la Direction est notifiée", async () => {
    en("resp");
    const r = await ajouterLiensResto(ids.beurre!, [ids.president!, ids.lurpak!]);
    expect(r).toEqual({ n: 0, enAttente: 2 });
    expect(await liens()).toEqual([]);
    const [d] = await demandes();
    expect(d).toMatchObject({ statut: "EN_ATTENTE", auteurId: U.resp.id });
    expect(d!.resume).toContain("Rattacher 2 articles");
    expect(d!.resume).toContain("« Beurre Président », « Beurre Lurpak »");
    expect((await prisma.notification.findMany()).map((n) => n.lien)).toEqual(["/stock/a-valider"]);
    expect(await journal()).toEqual([]); // rien d'écrit sur l'article du restaurant
  });

  it("détacher : demande, le lien reste en place", async () => {
    await ajouterLiensResto(ids.beurre!, [ids.president!]);
    en("resp");
    expect(await retirerLiensResto(ids.beurre!, [ids.president!])).toEqual({ n: 0, enAttente: 1 });
    expect(await liens()).toEqual([ids.president]);
    expect((await demandes())[0]!.resume).toBe("Détacher « Beurre Président » de « Beurre » (Cuisine)");
  });

  it("une seconde demande sur le même couple est refusée en le disant", async () => {
    en("resp");
    await ajouterLiensResto(ids.beurre!, [ids.president!]);
    expect(erreurDe(await ajouterLiensResto(ids.beurre!, [ids.president!]))).toContain("une demande est déjà en attente de la Direction");
    expect(await demandes()).toHaveLength(1);
  });

  it("les propositions cochées (noms identiques) suivent la même règle : une demande, rien de rattaché", async () => {
    en("resp");
    const sel = await prisma.articleStock.create({ data: { designation: "Sel fin", domaine: "NOURRITURE", unite: "kg" } });
    const rs = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Sel fin", unite: "kg" } });
    expect(await accepterPropositions([rs.id])).toMatchObject({ n: 0, enAttente: 1 });
    expect(await prisma.articleRestoStock.count({ where: { articleRestoId: rs.id } })).toBe(0);
    expect((await demandes())[0]!.resume).toBe("Rattacher « Sel fin » à « Sel fin » (Cuisine)");
    expect(sel.id).toBeTruthy();
  });
});

describe("la Direction décide", () => {
  it("approuver un rattachement : le lien est posé et journalisé « (proposition validée) », la demande passe à VALIDEE", async () => {
    en("resp");
    await ajouterLiensResto(ids.beurre!, [ids.lurpak!]);
    const [d] = await demandes();
    en("dir");
    await validerDemandes([d!.id], {}, { [d!.id]: await version(d!.id) });
    expect(await liens()).toEqual([ids.lurpak]);
    expect((await demandes())[0]).toMatchObject({ statut: "VALIDEE", decideurId: U.dir.id });
    expect(await journal()).toEqual([{ champ: "lien article du catalogue (proposition validée)", ancienneValeur: null, nouvelleValeur: "Beurre Lurpak", userId: U.dir.id }]);
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
  });

  it("approuver un détachement : le lien est retiré et journalisé", async () => {
    await ajouterLiensResto(ids.beurre!, [ids.president!, ids.vache!]);
    en("resp");
    await retirerLiensResto(ids.beurre!, [ids.vache!]);
    const [d] = await demandes();
    en("dir");
    await validerDemandes([d!.id], {}, { [d!.id]: await version(d!.id) });
    expect(await liens()).toEqual([ids.president]);
    expect((await journal()).at(-1)).toEqual({ champ: "lien article du catalogue (proposition validée)", ancienneValeur: "Beurre Vache qui rit", nouvelleValeur: null, userId: U.dir.id });
  });

  it("refuser avec un motif : rien n'est appliqué, la demande est REFUSEE avec son motif", async () => {
    en("resp");
    await ajouterLiensResto(ids.beurre!, [ids.lurpak!]);
    const [d] = await demandes();
    en("dir");
    await refuserDemandes([d!.id], "Autre produit", { [d!.id]: await version(d!.id) });
    expect(await liens()).toEqual([]);
    expect((await demandes())[0]).toMatchObject({ statut: "REFUSEE", motifRefus: "Autre produit" });
  });

  it("demande PÉRIMÉE (le lien a été posé entre-temps) : la validation refuse, rien n'est écrit, la demande reste en attente", async () => {
    en("resp");
    await ajouterLiensResto(ids.beurre!, [ids.lurpak!]);
    const [d] = await demandes();
    en("dir");
    await ajouterLiensResto(ids.beurre!, [ids.lurpak!]); // la Direction l'a posé elle-même entre-temps
    const avant = (await journal()).length;
    const r = await validerDemandes([d!.id], {}, { [d!.id]: await version(d!.id) });
    expect(JSON.stringify(r)).toContain("déjà rattaché");
    expect(JSON.stringify(r)).toContain("rien n'a été écrit");
    expect((await demandes())[0]!.statut).toBe("EN_ATTENTE");
    expect(await liens()).toEqual([ids.lurpak]);
    expect((await journal()).length).toBe(avant);
  });

  it("détachement PÉRIMÉ (déjà retiré entre-temps) : refusé de même", async () => {
    await ajouterLiensResto(ids.beurre!, [ids.president!]);
    en("resp");
    await retirerLiensResto(ids.beurre!, [ids.president!]);
    const [d] = await demandes();
    en("dir");
    await retirerLiensResto(ids.beurre!, [ids.president!]);
    const r = await validerDemandes([d!.id], {}, { [d!.id]: await version(d!.id) });
    expect(JSON.stringify(r)).toContain("déjà retiré");
    expect((await demandes())[0]!.statut).toBe("EN_ATTENTE");
  });
});
