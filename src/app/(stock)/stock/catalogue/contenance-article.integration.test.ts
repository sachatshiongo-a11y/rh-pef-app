import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Contenance d'un article saisie au catalogue (« Modifier » de la fiche article, `modifierArticle`) :
// écrite avec son unité, refusée en clair sans rien écrire si elle est incomplète, jamais effacée
// par une modification qui ne la porte pas (case éditable de l'Inventaire).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: "seed", role: "ADMIN", nom: "T" }), requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));

const { modifierArticle } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "seed", email: "t@pef.test", nom: "T", role: "ADMIN" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("contenance d'un article au catalogue", () => {
  it("écrite avec son unité ; incomplète : refusée sans rien écrire ; absente du formulaire : conservée", async () => {
    const a = await prisma.articleStock.create({ data: { designation: "Absolut Vodka-75cl", domaine: "BOISSON", unite: "Bouteille" } });
    expect(await modifierArticle(a.id, fd({ contenance: "75", contenanceUnite: "cl" }))).toBeUndefined();
    let lu = await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } });
    expect([lu.contenance?.toString(), lu.contenanceUnite]).toEqual(["75", "cl"]);

    expect(await modifierArticle(a.id, fd({ designation: "Absolut", contenance: "75", contenanceUnite: "" }))).toEqual({ erreur: expect.stringContaining("nombre ET une unité") });
    lu = await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } });
    expect([lu.designation, lu.contenance?.toString()]).toEqual(["Absolut Vodka-75cl", "75"]); // rien écrit

    await modifierArticle(a.id, fd({ unite: "Bouteille(s)" })); // case de l'Inventaire : ne porte pas la contenance
    lu = await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } });
    expect([lu.unite, lu.contenance?.toString()]).toEqual(["Bouteille(s)", "75"]);

    await modifierArticle(a.id, fd({ contenance: "", contenanceUnite: "" })); // vidée explicitement
    lu = await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } });
    expect([lu.contenance, lu.contenanceUnite]).toEqual([null, null]);
  });
});
