import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// « Changer le motif » des sorties sélectionnées (décision de la Direction, 2026-09-28) : une
// REQUALIFICATION, pas un mouvement — le stock du dépôt ne bouge jamais ; chaque changement est
// journalisé ; une période clôturée refuse, avec un message lisible. Base éphémère, jamais la prod.
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
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/alerte-stock", () => ({ niveauxActuels: async () => new Map(), notifierNouvellesAlertes: async () => {} }));

const { requalifierSorties } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "motif@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  A.user.role = "ADMIN";
  await prisma.journalAudit.deleteMany();
  await prisma.clotureStock.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  const a = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg" } });
  articleId = a.id;
  await prisma.stock.create({ data: { articleId, quantite: "7" } });
});

const sortie = (date: string, categorieSortie: string | null, origine: string | null = "Import Excel juillet") =>
  prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite: "3", date: new Date(date), categorieSortie, origine } });
const lire = (id: string) => prisma.mouvementStock.findUniqueOrThrow({ where: { id } });
const stock = async () => (await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite.toString();
const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error("Action acceptée alors qu'elle aurait dû être refusée.");
};

describe("requalifier le motif des sorties", () => {
  it("sans motif → Livraison restaurant : motif posé, stock du dépôt inchangé, chaque changement journalisé", async () => {
    const s1 = await sortie("2026-07-10", null);
    const s2 = await sortie("2026-07-11", null);
    const r = await requalifierSorties([s1.id, s2.id], "LIVRAISON_RESTAURANT");
    expect(r).toEqual({ n: 2 });
    expect((await lire(s1.id)).categorieSortie).toBe("LIVRAISON_RESTAURANT");
    expect((await lire(s2.id)).categorieSortie).toBe("LIVRAISON_RESTAURANT");
    expect((await lire(s1.id)).origine).toBe("Import Excel juillet"); // libellé d'origine saisi : conservé
    expect((await lire(s1.id)).quantite.toString()).toBe("3");
    expect(await stock()).toBe("7");
    const journal = await prisma.journalAudit.findMany({ where: { entite: "MouvementStock" }, orderBy: { entiteId: "asc" } });
    expect(journal.map((j) => [j.entiteId, j.champ, j.ancienneValeur, j.nouvelleValeur])).toEqual(
      [s1.id, s2.id].sort().map((id) => [id, "categorieSortie", "sans motif", "LIVRAISON_RESTAURANT"]),
    );
  }, 60_000);

  it("Perte : la raison est obligatoire ; posée, elle est enregistrée", async () => {
    const s = await sortie("2026-07-10", "LIVRAISON_RESTAURANT", "Livraison restaurant");
    expect(erreurDe(await requalifierSorties([s.id], "PERTE", "  "))).toBe("Indiquez la raison de la perte.");
    expect((await lire(s.id)).categorieSortie).toBe("LIVRAISON_RESTAURANT");
    expect(await requalifierSorties([s.id], "PERTE", "cassé")).toEqual({ n: 1 });
    const m = await lire(s.id);
    expect([m.categorieSortie, m.raisonSortie, m.origine]).toEqual(["PERTE", "cassé", "Perte — cassé"]); // libellé automatique suivi
    expect(await stock()).toBe("7");
  }, 60_000);

  it("« Sans motif » retire le motif et la raison", async () => {
    const s = await prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite: "1", date: new Date("2026-07-10"), categorieSortie: "PERTE", raisonSortie: "cassé", origine: "Perte — cassé" } });
    expect(await requalifierSorties([s.id], "")).toEqual({ n: 1 });
    const m = await lire(s.id);
    expect([m.categorieSortie, m.raisonSortie, m.origine]).toEqual([null, null, "Sortie / consommation"]);
  }, 60_000);

  it("refuse une entrée dans la sélection, une période clôturée, un non-Direction — sans rien écrire", async () => {
    const s = await sortie("2026-07-10", null);
    const e = await prisma.mouvementStock.create({ data: { articleId, type: "ENTREE", quantite: "1", date: new Date("2026-07-10") } });
    expect(erreurDe(await requalifierSorties([s.id, e.id], "PERTE", "x"))).toMatch(/Seules les sorties/);

    await prisma.clotureStock.create({ data: { annee: 2026, mois: 7 } });
    expect(erreurDe(await requalifierSorties([s.id], "LIVRAISON_RESTAURANT"))).toBe(
      "La période 07/2026 est clôturée : le motif de ses sorties ne peut plus être changé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)",
    );
    await prisma.clotureStock.deleteMany();

    A.user.role = "STOCK";
    expect(erreurDe(await requalifierSorties([s.id], "LIVRAISON_RESTAURANT"))).toMatch(/Accès refusé/);
    expect((await lire(s.id)).categorieSortie).toBeNull();
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it("déjà au bon motif : rien n'est réécrit ni journalisé", async () => {
    const s = await sortie("2026-07-10", "LIVRAISON_RESTAURANT");
    expect(await requalifierSorties([s.id], "LIVRAISON_RESTAURANT")).toEqual({ n: 0 });
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);
});
