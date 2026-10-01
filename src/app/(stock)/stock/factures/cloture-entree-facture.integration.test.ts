import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : une facture enregistrée avec « entrer en
// stock » crée des entrées datées de la FACTURE. Défaut corrigé le 2026-10-01 : la clôture du stock
// contrôlait « aujourd'hui » — une facture datée d'un mois clôturé écrivait dans ce mois figé.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction", accesStock: false } }));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// redirect() de Next : une exception marquée, que `actionLisible` laisse passer.
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock/factures;307;" }); } }));

const { creerFactureAvecLignes } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const a = await prisma.articleStock.create({ data: { designation: "Riz", domaine: "NOURRITURE" } });
  articleId = a.id;
  await prisma.stock.create({ data: { articleId, quantite: 10 } });
  await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } }); // août 2026 clôturé
}, 120_000);
afterAll(async () => { await fermer?.(); });

const fd = (date: string) => {
  const f = new FormData();
  f.set("fournisseurNom", "ETS SENEVE"); f.set("date", date); f.set("entrerEnStock", "on"); f.set("forcerDoublons", "on");
  f.append("ligne_articleId", articleId); f.append("ligne_designation", "Riz"); f.append("ligne_unite", "Kg"); f.append("ligne_quantite", "5"); f.append("ligne_prix", "2");
  return f;
};

describe("Facture « entrer en stock » et clôture du stock", () => {
  it("facture datée d'un mois clôturé : refus lisible, ni facture ni entrée", async () => {
    expect(await creerFactureAvecLignes(fd("2026-08-20"))).toMatchObject({ erreur: expect.stringMatching(/clôtur/i) });
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite)).toBe(10);
  }, 60_000);

  it("facture datée d'un mois ouvert : entrée écrite à la date de la facture", async () => {
    await expect(creerFactureAvecLignes(fd("2026-09-05"))).rejects.toThrow("NEXT_REDIRECT");
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId } });
    expect(m.date.toISOString().slice(0, 10)).toBe("2026-09-05");
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite)).toBe(15);
  }, 60_000);
});
