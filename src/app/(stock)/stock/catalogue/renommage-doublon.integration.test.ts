import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — demande de la Direction du 2026-10-10 :
// l'anti-doublon de « Ajouter un article » s'applique aussi au RENOMMAGE (fiche article). Renommer
// « Tomate » alors que « Tomates » existe est refusé, en nommant l'article existant, par la Direction
// (écriture directe), à la PROPOSITION d'un autre rôle, et à l'APPROBATION (un doublon créé entre-temps).
// Seule une désignation qui change est contrôlée ; l'article lui-même ne compte pas (« tomate » → « Tomate »).
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

const { modifierArticle } = await import("./actions");
const { validerDemande } = await import("@/lib/validations-stock/demandes");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const art = (designation: string, extra: { domaine?: "NOURRITURE" | "BOISSON" | "AUTRE"; actif?: boolean } = {}) =>
  prisma.articleStock.create({ data: { designation, domaine: extra.domaine ?? "NOURRITURE", actif: extra.actif ?? true, stock: { create: { quantite: 3 } } } });
const nom = async (id: string) => (await prisma.articleStock.findUniqueOrThrow({ where: { id } })).designation;

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
});

describe("renommer un article — Direction (écriture directe)", () => {
  it.each(["Tomate", "tomates", "  TOMATES ", "Tomatés"])("« %s » refusé quand « Tomates » existe : l'article existant est nommé, rien n'est écrit", async (saisi) => {
    await art("Tomates");
    const a = await art("Oignons");
    const msg = erreurDe(await modifierArticle(a.id, fd({ designation: saisi })));
    expect(msg).toContain("« Tomates »");
    expect(msg).toContain("Rien n'a été modifié");
    expect(await nom(a.id)).toBe("Oignons");
  });

  it("même périmètre que la création : tout le catalogue, autre domaine et article inactif compris", async () => {
    await art("Sirop de menthe", { domaine: "BOISSON" });
    await art("Farine de maïs", { actif: false });
    const a = await art("Sucre");
    expect(erreurDe(await modifierArticle(a.id, fd({ designation: "sirop menthe" })))).toContain("« Sirop de menthe »");
    const msg = erreurDe(await modifierArticle(a.id, fd({ designation: "Farine de mais" })));
    expect(msg).toContain("« Farine de maïs » (inactif)");
    expect(await nom(a.id)).toBe("Sucre");
  });

  it("l'article lui-même ne compte pas : seule la casse change, « tomate » → « Tomate » passe", async () => {
    const a = await art("tomate");
    expect(erreurDe(await modifierArticle(a.id, fd({ designation: "Tomate" })))).toBeNull();
    expect(await nom(a.id)).toBe("Tomate");
  });

  it("un vrai nouveau nom passe, et les autres champs modifiés seuls ne déclenchent aucun contrôle", async () => {
    const a = await art("Poivrons");
    await art("Poivron"); // doublon DÉJÀ présent : la modification d'un autre champ ne le reproche pas
    expect(erreurDe(await modifierArticle(a.id, fd({ unite: "kg", designation: "Poivrons" })))).toBeNull(); // même désignation renvoyée par le formulaire
    expect(erreurDe(await modifierArticle(a.id, fd({ stockMinimum: "4" })))).toBeNull();
    expect(erreurDe(await modifierArticle(a.id, fd({ designation: "Piments" })))).toBeNull();
    expect(await nom(a.id)).toBe("Piments");
  });
});

describe("renommer un article — proposition d'un autre rôle", () => {
  it("refusée dès la proposition quand le nom existe déjà : aucune demande n'est créée", async () => {
    await art("Tomates");
    const a = await art("Oignons");
    en("resp");
    const msg = erreurDe(await modifierArticle(a.id, fd({ designation: "Tomate" })));
    expect(msg).toContain("« Tomates »");
    expect(await prisma.demandeValidationStock.count()).toBe(0);
    expect(await nom(a.id)).toBe("Oignons");
  });

  it("un nom libre est proposé, puis approuvé : l'article est renommé", async () => {
    const a = await art("Oignons");
    en("resp");
    expect(await modifierArticle(a.id, fd({ designation: "Oignons rouges" }))).toMatchObject({ proposition: true });
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { nature: "MODIF_ARTICLE" } });
    en("dir");
    await validerDemande({ id: U.dir.id, role: "ADMIN", nom: "Sacha" } as never, d.id, { version: d.updatedAt.toISOString() });
    expect(await nom(a.id)).toBe("Oignons rouges");
  });

  it("approbation APRÈS la création d'un doublon entre-temps : refusée proprement, rien n'est écrit, la demande reste en attente", async () => {
    const a = await art("Oignons");
    en("resp");
    expect(await modifierArticle(a.id, fd({ designation: "Echalotes", stockMinimum: "9" }))).toMatchObject({ proposition: true });
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { nature: "MODIF_ARTICLE" } });
    await art("Échalote"); // créé entre la proposition et l'approbation
    en("dir");
    const err = await validerDemande({ id: U.dir.id, role: "ADMIN", nom: "Sacha" } as never, d.id, { version: d.updatedAt.toISOString() }).then(() => null, (e: Error) => e.message);
    expect(err).toContain("« Échalote »");
    expect(await nom(a.id)).toBe("Oignons");
    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId: a.id } });
    expect(stock.stockMinimum.toString()).toBe("0"); // l'autre champ de la demande n'a pas été écrit non plus
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  });
});
