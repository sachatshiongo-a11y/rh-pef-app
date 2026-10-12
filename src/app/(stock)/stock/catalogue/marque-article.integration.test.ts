import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — MARQUE des articles (Direction, 2026-10-14) :
// deux articles de MÊME désignation mais de marques renseignées DIFFÉRENTES ne sont pas un doublon (création,
// renommage, changement de marque) ; même marque = doublon certain ; marque absente d'un côté = règle d'avant.
// Un autre rôle PROPOSE une marque (« À valider »), la Direction approuve. Ancien en-tête ci-dessous :
// (renommage — demande de la Direction du 2026-10-10 :
// l'anti-doublon de « Ajouter un article » s'applique aussi au RENOMMAGE (fiche article), à DEUX NIVEAUX comme
// la création : doublon CERTAIN (casse, accents, espaces : `memeDesignation`) = refus sec ; nom seulement PROCHE
// (« Tomate » / « Tomates ») = avertissement, accepté avec le drapeau « Renommer quand même », refusé sans.
// Direction (écriture directe), PROPOSITION d'un autre rôle (même logique), APPROBATION (seul un doublon
// CERTAIN apparu entre-temps bloque). Seule une désignation qui change est contrôlée ; l'article lui-même ne
// compte pas (« tomate » → « Tomate »).
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

const { modifierArticle, creerArticle } = await import("./actions");
const { validerDemande } = await import("@/lib/validations-stock/demandes");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : r && typeof r === "object" && "doublon" in r ? String((r as unknown as { message: string }).message) : null);
const certain = (r: unknown) => (r && typeof r === "object" && "doublon" in r ? (r as unknown as { creationPossible: boolean }).creationPossible === false : false);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const art = (designation: string, marque: string | null = null) =>
  prisma.articleStock.create({ data: { designation, marque, domaine: "NOURRITURE", stock: { create: { quantite: 3 } } } });
const lire = (id: string) => prisma.articleStock.findUniqueOrThrow({ where: { id } });

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

describe("créer un article avec une marque", () => {
  it("même désignation, marque différente : DEUX articles, pas un doublon ; la marque est enregistrée rognée", async () => {
    await art("Beurre doux", "Président");
    expect(erreurDe(await creerArticle(fd({ designation: "Beurre doux", marque: "  Lurpak ", domaine: "NOURRITURE" })))).toBeNull();
    const tous = await prisma.articleStock.findMany({ where: { designation: "Beurre doux" }, orderBy: { marque: "asc" } });
    expect(tous.map((a) => a.marque)).toEqual(["Lurpak", "Président"]);
  });

  it("même désignation, même marque (casse et accents ignorés) : doublon CERTAIN, rien n'est créé", async () => {
    await art("Beurre doux", "Président");
    const r = await creerArticle(fd({ designation: "beurre DOUX", marque: "president", domaine: "NOURRITURE" }));
    expect(certain(r)).toBe(true);
    expect(await prisma.articleStock.count()).toBe(1);
  });

  it("marque absente d'un côté : la règle d'avant (même désignation = doublon)", async () => {
    await art("Beurre doux", "Président");
    expect(certain(await creerArticle(fd({ designation: "Beurre doux", domaine: "NOURRITURE" })))).toBe(true);
    await prisma.articleStock.deleteMany();
    await art("Farine");
    expect(certain(await creerArticle(fd({ designation: "Farine", marque: "Grands Moulins", domaine: "NOURRITURE" })))).toBe(true);
    expect(await prisma.articleStock.count()).toBe(1);
  });
});

describe("changer la marque ou la désignation d'un article", () => {
  it("Direction : la marque s'écrit directement, sans toucher la désignation ; la vider est permis", async () => {
    const a = await art("Beurre doux");
    expect(erreurDe(await modifierArticle(a.id, fd({ marque: "Lurpak" })))).toBeNull();
    expect(await lire(a.id)).toMatchObject({ designation: "Beurre doux", marque: "Lurpak" });
    expect(erreurDe(await modifierArticle(a.id, fd({ marque: "" })))).toBeNull();
    expect((await lire(a.id)).marque).toBeNull();
  });

  it("la marque d'un article ne peut pas rejoindre celle d'un article de même désignation (doublon certain)", async () => {
    await art("Beurre doux", "Président");
    const b = await art("Beurre doux", "Lurpak");
    const r = await modifierArticle(b.id, fd({ marque: "Président" }));
    expect(certain(r)).toBe(true);
    expect((await lire(b.id)).marque).toBe("Lurpak");
    // … une marque libre passe
    expect(erreurDe(await modifierArticle(b.id, fd({ marque: "Elle & Vire" })))).toBeNull();
  });

  it("renommer vers la désignation d'un article d'une AUTRE marque est permis ; vers celle de la même marque, non", async () => {
    await art("Beurre doux", "Président");
    const b = await art("Beurre salé", "Lurpak");
    expect(erreurDe(await modifierArticle(b.id, fd({ designation: "Beurre doux" })))).toBeNull();
    const c = await art("Beurre salé", "Président");
    expect(certain(await modifierArticle(c.id, fd({ designation: "Beurre doux" })))).toBe(true);
    expect((await lire(c.id)).designation).toBe("Beurre salé");
  });

  it("un autre rôle PROPOSE la marque : rien ne change avant la décision, la Direction approuve", async () => {
    const a = await art("Beurre doux");
    en("resp");
    expect(await modifierArticle(a.id, fd({ marque: "Lurpak" }))).toMatchObject({ proposition: true });
    expect((await lire(a.id)).marque).toBeNull();
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { nature: "MODIF_ARTICLE" } });
    en("dir");
    await validerDemande({ id: U.dir.id, role: "ADMIN", nom: "Sacha" } as never, d.id, { version: d.updatedAt.toISOString() });
    expect(await lire(a.id)).toMatchObject({ designation: "Beurre doux", marque: "Lurpak" });
  });

  it("proposition d'une marque déjà prise par un article de même désignation : refusée dès la proposition, aucune demande", async () => {
    await art("Beurre doux", "Président");
    const b = await art("Beurre doux", "Lurpak");
    en("resp");
    expect(certain(await modifierArticle(b.id, fd({ marque: "président" })))).toBe(true);
    expect(await prisma.demandeValidationStock.count()).toBe(0);
  });

  it("marque prise ENTRE la proposition et l'approbation : approbation refusée proprement, la demande reste en attente", async () => {
    const a = await art("Beurre doux");
    en("resp");
    expect(await modifierArticle(a.id, fd({ marque: "Lurpak" }))).toMatchObject({ proposition: true });
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { nature: "MODIF_ARTICLE" } });
    await art("Beurre doux", "Lurpak");
    en("dir");
    const err = await validerDemande({ id: U.dir.id, role: "ADMIN", nom: "Sacha" } as never, d.id, { version: d.updatedAt.toISOString() }).then(() => null, (e: Error) => e.message);
    expect(err).toContain("Beurre doux");
    expect((await lire(a.id)).marque).toBeNull();
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  });
});
