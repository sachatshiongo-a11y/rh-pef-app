// Supprimer plusieurs fournisseurs d'un coup : mêmes règles que la suppression unitaire (achats directs = refus),
// refus nommés, les autres passent ; au-delà du plafond rien n'est supprimé.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  achats: new Map<string, number>(),
  supprimes: [] as string[],
}));
vi.mock("@/lib/auth", () => ({ verifySession: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireModule: vi.fn(), requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ journaliser: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fournisseur: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, nom: `Nom ${id}` }))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, nom: `Nom ${where.id}` })),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { m.supprimes.push(where.id); }),
    },
    mouvementStock: { count: vi.fn(async ({ where }: { where: { fournisseurId: string } }) => m.achats.get(where.fournisseurId) ?? 0) },
  },
}));

import { supprimerFournisseursEnLot } from "./actions";

beforeEach(() => { m.achats.clear(); m.supprimes.length = 0; });

describe("supprimerFournisseursEnLot", () => {
  it("supprime tous les fournisseurs choisis (doublons écartés)", async () => {
    expect(await supprimerFournisseursEnLot(["a", "b", "a"])).toEqual({ traitees: 2, echecs: [] });
    expect(m.supprimes).toEqual(["a", "b"]);
  });

  it("un fournisseur qui porte des achats directs est refusé et nommé ; les autres sont supprimés", async () => {
    m.achats.set("b", 3);
    const r = await supprimerFournisseursEnLot(["a", "b", "c"]) as { traitees: number; echecs: string[] };
    expect(r.traitees).toBe(2);
    expect(r.echecs).toHaveLength(1);
    expect(r.echecs[0]).toContain("Nom b : Suppression impossible : 3 achat(s) direct(s)");
    expect(m.supprimes).toEqual(["a", "c"]);
  });

  it("plus de 50 : rien n'est supprimé, la raison est dite", async () => {
    const r = await supprimerFournisseursEnLot(Array.from({ length: 51 }, (_, i) => `x${i}`));
    expect(r).toMatchObject({ erreur: expect.stringContaining("50 fournisseurs au plus") });
    expect(m.supprimes).toEqual([]);
  });
});
