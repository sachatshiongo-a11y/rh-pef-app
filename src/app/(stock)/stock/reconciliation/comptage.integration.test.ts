import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION : exécute le vrai `appliquerComptage` contre un Postgres éphémère (jamais la
// prod). Seuls l'authentification, le cache Next et les notifications sont neutralisés ; toute la
// logique métier + les écritures Prisma sont réelles.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/alerte-stock", () => ({ notifierNouvellesAlertes: async () => {} }));

const { appliquerComptage } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "test@pef.cd", nom: "Testeur", role: "ADMIN" } });
  A.user.id = u.id;
  const art = await prisma.articleStock.create({ data: { designation: "Riz basmati 5kg", domaine: "NOURRITURE", unite: "Sac" } });
  articleId = art.id;
  await prisma.stock.create({ data: { articleId, quantite: 10, stockMinimum: 4 } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

const fd = (physique: number, explication = "") => {
  const f = new FormData();
  f.set("recon_articleId", articleId);
  f.set("recon_physique", String(physique));
  f.set("recon_explication", explication);
  f.set("domaine", "NOURRITURE");
  f.set("origine", "Comptage test");
  return f;
};

describe("appliquerComptage — écriture + garde de tolérance (Postgres éphémère)", () => {
  it("ajuste le stock au réel et crée le mouvement + la fiche de comptage (écart dans la tolérance)", async () => {
    await appliquerComptage(fd(9)); // théorique 10 → physique 9 = -10% (≤ seuil 10 %, pas d'explication requise)

    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(stock.quantite)).toBe(9); // stock mis au réel

    const mvts = await prisma.mouvementStock.findMany({ where: { articleId, type: "AJUSTEMENT" } });
    expect(mvts).toHaveLength(1);
    expect(Number(mvts[0].quantite)).toBe(1); // |écart| = 1

    const session = await prisma.sessionComptage.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(session.nbEcarts).toBe(1);
    const lignes = await prisma.ligneComptage.findMany({ where: { sessionId: session.id } });
    expect(lignes).toHaveLength(1);
    expect(Number(lignes[0].physique)).toBe(9);
  }, 60_000);

  it("refuse un écart hors tolérance sans explication (aucune écriture)", async () => {
    const avant = await prisma.mouvementStock.count();
    // stock now 9 → physique 3 = -66 % (> 10 %) sans explication → doit lever une erreur.
    await expect(appliquerComptage(fd(3))).rejects.toThrow(/explication/i);

    const apres = await prisma.mouvementStock.count();
    expect(apres).toBe(avant); // rien n'a été écrit
    const stock = await prisma.stock.findUniqueOrThrow({ where: { articleId } });
    expect(Number(stock.quantite)).toBe(9); // stock inchangé
  }, 60_000);
});
