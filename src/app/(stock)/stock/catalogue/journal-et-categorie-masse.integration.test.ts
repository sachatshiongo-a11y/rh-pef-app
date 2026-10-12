import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit du 10/10/2026, stock 17 et 20 :
//  - « Catégoriser en masse » refuse une catégorie qui n'est pas du domaine de l'article, en NOMMANT les articles
//    (tout ou rien, Direction comme proposition d'un autre rôle) ; la catégorie du bon domaine passe, et le
//    journal garde son NOM ;
//  - `modifierArticle` journalise l'avant → après des champs réellement changés.
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

const { categoriserEnMasse, modifierArticle } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
let epicerie: string, softs: string;
const art = (designation: string, domaine: "NOURRITURE" | "BOISSON", extra: { categorieId?: string } = {}) =>
  prisma.articleStock.create({ data: { designation, domaine, categorieId: extra.categorieId ?? null, stock: { create: { quantite: 3 } } } });
const categorieDe = async (id: string) => (await prisma.articleStock.findUniqueOrThrow({ where: { id } })).categorieId;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
  epicerie = (await prisma.categorieStock.create({ data: { nom: "Épicerie", domaine: "NOURRITURE" } })).id;
  softs = (await prisma.categorieStock.create({ data: { nom: "Softs", domaine: "BOISSON" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

describe("catégoriser en masse — la catégorie doit être du domaine de l'article", () => {
  it("refus tout ou rien qui NOMME les articles d'un autre domaine ; rien n'est modifié", async () => {
    const riz = await art("Riz", "NOURRITURE");
    const cola = await art("Cola", "BOISSON");
    const eau = await art("Eau", "BOISSON");
    const r = await categoriserEnMasse([riz.id, cola.id, eau.id], epicerie);
    expect(erreurDe(r)).toContain("« Épicerie » est du domaine Nourriture");
    expect(erreurDe(r)).toContain("« Cola », « Eau »");
    expect(erreurDe(r)).not.toContain("« Riz »");
    expect(erreurDe(r)).toContain("Rien n'a été modifié");
    expect(await categorieDe(riz.id)).toBeNull(); // même l'article valide n'a pas bougé
    expect(await categorieDe(cola.id)).toBeNull();
  });

  it("un compte non-Direction est refusé de même (aucune proposition ne part)", async () => {
    const cola = await art("Cola", "BOISSON");
    en("resp");
    expect(erreurDe(await categoriserEnMasse([cola.id], epicerie))).toContain("« Cola »");
    expect(await prisma.demandeValidationStock.count()).toBe(0);
  });

  it("la catégorie du bon domaine passe, et le journal garde son NOM", async () => {
    const cola = await art("Cola", "BOISSON");
    const eau = await art("Eau", "BOISSON");
    expect(erreurDe(await categoriserEnMasse([cola.id, eau.id], softs))).toBeNull();
    expect(await categorieDe(cola.id)).toBe(softs);
    const j = await prisma.journalAudit.findFirstOrThrow({ where: { champ: "categorie (masse)" } });
    expect(j.nouvelleValeur).toBe("Softs");
  });

  it("l'article qui porte déjà cette catégorie la garde (classement d'hier non reproché)", async () => {
    const vieux = await art("Vieux jus", "NOURRITURE", { categorieId: softs }); // donnée ancienne : catégorie d'un autre domaine
    expect(erreurDe(await categoriserEnMasse([vieux.id], softs))).toBeNull();
  });
});

describe("modifierArticle — le journal écrit l'avant → après", () => {
  it("seuls les champs changés sont journalisés, avec leur valeur d'avant et d'après", async () => {
    const a = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "2.5", stock: { create: { quantite: 3, stockMinimum: 2 } } } });
    expect(erreurDe(await modifierArticle(a.id, fd({ designation: "Farine", unite: "g", prixUnitaireUSD: "3", stockMinimum: "2" })) as unknown)).toBeNull();
    const j = await prisma.journalAudit.findFirstOrThrow({ where: { entite: "ArticleStock", entiteId: a.id, champ: "modification" } });
    expect(j.nouvelleValeur).toContain("Unité : kg → g");
    expect(j.nouvelleValeur).toContain("Prix unitaire USD : 2,5 → 3");
    expect(j.nouvelleValeur).not.toContain("Désignation");
    expect(j.nouvelleValeur).not.toContain("Stock minimum");
  });
});
