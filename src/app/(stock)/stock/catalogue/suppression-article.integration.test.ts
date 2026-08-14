import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Garde-fou de suppression d'un article du catalogue. `IngredientFiche.articleId` est en
// `onDelete: Restrict` : sans contrôle explicite, un article utilisé dans une FICHE TECHNIQUE et
// sans autre historique passait le garde-fou, puis Postgres refusait la suppression avec un
// message brut en anglais. Ce test vérifie que le refus est ANNONCÉ, en français, en NOMMANT la
// fiche — et qu'un article vraiment vierge reste supprimable.
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

// `supprimerArticle` est une action de FORMULAIRE : son erreur métier revient par une redirection
// vers `?erreur=<message>` (cf. src/lib/erreur-formulaire.ts). On capture donc la redirection.
const R = vi.hoisted(() => ({ cible: null as string | null }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    R.cible = url;
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));

const { supprimerArticle } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

/** Message lisible extrait de la redirection d'erreur (`?erreur=…`), ou `null` si succès. */
async function supprimer(id: string): Promise<string | null> {
  R.cible = null;
  try {
    await supprimerArticle(id);
  } catch {
    // redirection (succès comme erreur) : la cible porte l'information
  }
  const url = R.cible ?? "";
  const i = url.indexOf("erreur=");
  return i === -1 ? null : decodeURIComponent(url.slice(i + "erreur=".length));
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "t@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("supprimerArticle — un article utilisé dans une fiche technique", () => {
  it("refuse la suppression en NOMMANT la fiche, au lieu d'une erreur Postgres brute", async () => {
    const art = await prisma.articleStock.create({ data: { designation: "Basilic séché", domaine: "NOURRITURE", unite: "kg" } });
    const fiche = await prisma.ficheTechnique.create({ data: { nom: "Coulis de tomate", nbPortions: 4 } });
    await prisma.ingredientFiche.create({ data: { ficheId: fiche.id, articleId: art.id, unite: "g", quantite: 20 } });

    const message = await supprimer(art.id);

    expect(message).toBeTruthy();
    expect(message).toContain("Basilic séché");
    expect(message).toContain("fiche technique");
    expect(message).toContain("Coulis de tomate"); // la fiche est nommée : on sait où aller
    expect(message).not.toMatch(/foreign key|constraint|violates/i); // jamais du Postgres brut
    // Rien n'a été détruit : ni l'article, ni sa ligne d'ingrédient.
    expect(await prisma.articleStock.findUnique({ where: { id: art.id } })).not.toBeNull();
    expect(await prisma.ingredientFiche.count({ where: { articleId: art.id } })).toBe(1);
  }, 60_000);

  it("supprime un article vierge (aucun historique, aucune fiche)", async () => {
    const art = await prisma.articleStock.create({ data: { designation: "Article jamais utilisé", domaine: "AUTRE" } });
    await prisma.stock.create({ data: { articleId: art.id, quantite: 0 } });

    expect(await supprimer(art.id)).toBeNull(); // pas de message d'erreur : succès
    expect(await prisma.articleStock.findUnique({ where: { id: art.id } })).toBeNull();
  }, 60_000);
});
