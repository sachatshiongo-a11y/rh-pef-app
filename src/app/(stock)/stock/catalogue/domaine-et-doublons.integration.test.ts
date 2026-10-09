import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — demandes de Sacha du 2026-10-09 :
//  1. « on doit pouvoir changer le statut d'un article, de boissons à nourriture etc. » : domaine
//     modifiable (fiche et action groupée) ; Direction directe, autre compte = proposition validée par
//     la Direction ; la catégorie suit (même nom, sinon « à classer », ou choisie) ; ni stock ni mouvement.
//  2. Anti-doublon à la création d'article (« Ajouter un article » de l'Inventaire) : même règle que
//     la Liste d'achat — nom exact refusé, nom proche = choix explicite « Créer quand même ».
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

const { changerDomaineEnMasse, modifierArticle, creerArticle } = await import("./actions");
const { validerDemande } = await import("@/lib/validations-stock/demandes");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.categorieStock.deleteMany();
});

async function cats() {
  const [jusN, viandes, jusB, sodas] = await Promise.all([
    prisma.categorieStock.create({ data: { nom: "Jus", domaine: "NOURRITURE" } }),
    prisma.categorieStock.create({ data: { nom: "Viandes", domaine: "NOURRITURE" } }),
    prisma.categorieStock.create({ data: { nom: "Jus", domaine: "BOISSON" } }),
    prisma.categorieStock.create({ data: { nom: "Sodas", domaine: "BOISSON" } }),
  ]);
  return { jusN: jusN.id, viandes: viandes.id, jusB: jusB.id, sodas: sodas.id };
}
const art = (designation: string, domaine: "NOURRITURE" | "BOISSON" | "AUTRE", categorieId: string | null, quantite = 7) =>
  prisma.articleStock.create({ data: { designation, domaine, categorieId, stock: { create: { quantite } } } }).then((a) => a.id);
const etat = (id: string) => prisma.articleStock.findUniqueOrThrow({ where: { id }, select: { domaine: true, categorieId: true, stock: { select: { quantite: true } } } });

describe("changer le domaine d'un article", () => {
  it("Direction, action groupée : catégorie du même nom reprise, sinon « à classer » ; ni stock ni mouvement ne change", async () => {
    const c = await cats();
    const jus = await art("Jus d'orange", "NOURRITURE", c.jusN);
    const steak = await art("Steak", "NOURRITURE", c.viandes);
    const sans = await art("Glaçons", "NOURRITURE", null);
    const r = await changerDomaineEnMasse([jus, steak, sans], "BOISSON");
    expect(erreurDe(r)).toBeNull();
    expect((r as { message: string }).message).toContain("3 article(s) passé(s) en Boissons");
    expect((r as { message: string }).message).toContain("1 remis « à classer » (catégorie absente en Boissons) : « Steak »");
    expect(await etat(jus)).toMatchObject({ domaine: "BOISSON", categorieId: c.jusB });
    expect(await etat(steak)).toMatchObject({ domaine: "BOISSON", categorieId: null });
    expect(await etat(sans)).toMatchObject({ domaine: "BOISSON", categorieId: null });
    expect(Number((await etat(jus)).stock?.quantite)).toBe(7);
    expect(await prisma.mouvementStock.count()).toBe(0);
  });

  it("catégorie choisie : doit être du nouveau domaine ; « à classer » pour tous ; domaine illisible refusé", async () => {
    const c = await cats();
    const jus = await art("Jus d'orange", "NOURRITURE", c.jusN);
    expect(erreurDe(await changerDomaineEnMasse([jus], "BOISSON", c.viandes))).toContain("n'appartient pas au nouveau domaine");
    expect(erreurDe(await changerDomaineEnMasse([jus], "VIN"))).toContain("Domaine inconnu");
    expect((await etat(jus)).domaine).toBe("NOURRITURE");
    expect(erreurDe(await changerDomaineEnMasse([jus], "BOISSON", "A_CLASSER"))).toBeNull();
    expect(await etat(jus)).toMatchObject({ domaine: "BOISSON", categorieId: null });
    const coca = await art("Coca", "NOURRITURE", c.jusN);
    await changerDomaineEnMasse([coca], "BOISSON", c.sodas);
    expect(await etat(coca)).toMatchObject({ domaine: "BOISSON", categorieId: c.sodas });
  });

  it("fiche article : changer le domaine sans changer une catégorie de l'ancien domaine est refusé ; avec « à classer », accepté", async () => {
    const c = await cats();
    const steak = await art("Steak", "NOURRITURE", c.viandes);
    const fd = new FormData(); fd.set("domaine", "AUTRE"); fd.set("categorieId", c.viandes);
    expect(erreurDe(await modifierArticle(steak, fd))).toContain("« Steak » passe en Autre : sa catégorie « Viandes » n'existe pas dans ce domaine");
    expect((await etat(steak)).domaine).toBe("NOURRITURE");
    fd.set("categorieId", "");
    expect(erreurDe(await modifierArticle(steak, fd))).toBeNull();
    expect(await etat(steak)).toMatchObject({ domaine: "AUTRE", categorieId: null });
  });

  it("compte non-Direction : PROPOSITION (avant → après), rien ne change avant la validation de la Direction", async () => {
    const c = await cats();
    const jus = await art("Jus d'orange", "NOURRITURE", c.jusN);
    en("resp");
    const r = await changerDomaineEnMasse([jus], "BOISSON");
    expect(r).toMatchObject({ proposition: true });
    expect((await etat(jus)).domaine).toBe("NOURRITURE");
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { nature: "MODIF_ARTICLE" } });
    expect(d.resume).toBe("« Jus d'orange » : Domaine, Catégorie");
    const ch = (d.charge as { articles: { changements: { champ: string; avantLibelle: string; apresLibelle: string }[] }[] }).articles[0]!.changements;
    expect(ch.map((x) => [x.champ, x.avantLibelle, x.apresLibelle])).toEqual([["domaine", "Nourriture", "Boissons"], ["categorieId", "Jus (Nourriture)", "Jus (Boissons)"]]);
    en("dir");
    await validerDemande({ id: U.dir.id, role: "ADMIN", nom: "Sacha" } as never, d.id, { version: d.updatedAt.toISOString() });
    expect(await etat(jus)).toMatchObject({ domaine: "BOISSON", categorieId: c.jusB });
  });

  it("non-Direction depuis la fiche : catégorie de l'ancien domaine refusée dès la proposition", async () => {
    const c = await cats();
    const steak = await art("Steak", "NOURRITURE", c.viandes);
    en("resp");
    const fd = new FormData(); fd.set("domaine", "BOISSON"); fd.set("categorieId", c.viandes);
    expect(erreurDe(await modifierArticle(steak, fd))).toContain("n'existe pas dans ce domaine");
    expect(await prisma.demandeValidationStock.count()).toBe(0);
  });
});

describe("anti-doublon : « Ajouter un article » de l'Inventaire", () => {
  const fd = (designation: string, extra: Record<string, string> = {}) => { const f = new FormData(); f.set("designation", designation); f.set("domaine", "NOURRITURE"); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f; };

  it("nom proche : rien n'est créé, les proches sont rendus ; « Créer quand même » crée", async () => {
    const tomates = await art("Tomates", "NOURRITURE", null);
    const r = await creerArticle(fd("Tomate"));
    expect(r).toMatchObject({ doublon: true, creationPossible: true, candidats: [{ id: tomates, designation: "Tomates" }] });
    expect(await prisma.articleStock.count()).toBe(1);
    expect(erreurDe(await creerArticle(fd("Tomate", { creerQuandMeme: "1" })))).toBeNull();
    expect(await prisma.articleStock.count({ where: { designation: "Tomate" } })).toBe(1);
  });

  it("nom EXACT déjà au catalogue (casse, accents, contenance écrite autrement ; même inactif) : refusé, même avec « Créer quand même »", async () => {
    await prisma.articleStock.create({ data: { designation: "Coca-Cola 33cl", domaine: "BOISSON", actif: false } });
    for (const extra of [{}, { creerQuandMeme: "1" }] as Record<string, string>[]) {
      const r = await creerArticle(fd("coca cola 330 ml", extra));
      expect(r).toMatchObject({ doublon: true, creationPossible: false });
      expect((r as { message: string }).message).toContain("existe déjà au catalogue");
    }
    expect(await prisma.articleStock.count()).toBe(1);
  });

  it("nom nouveau : créé directement, sans question", async () => {
    await art("Riz", "NOURRITURE", null);
    expect(await creerArticle(fd("Huile de palme"))).toBeUndefined();
    expect(await prisma.articleStock.count()).toBe(2);
  });
});
