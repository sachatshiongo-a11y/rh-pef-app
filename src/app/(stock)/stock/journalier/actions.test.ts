// Appels serveur par case de la grille Commande : une écriture, et AUCUNE revalidation de page
// (avant le 2026-09-24 : 1 revalidatePath par case = toute la page recalculée — 3 requêtes
// Prisma — et renvoyée au navigateur). La revalidation n'a lieu qu'une fois par rafale.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  upsert: vi.fn(async () => ({})),
  deleteMany: vi.fn(async () => ({ count: 1 })),
  upsertLeg: vi.fn(async () => ({})),
  deleteManyLeg: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ verifySession: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireModule: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    commandeResto: { upsert: m.upsert, deleteMany: m.deleteMany },
    commandeLegumeResto: { upsert: m.upsertLeg, deleteMany: m.deleteManyLeg },
  },
}));

import { saisirCommandeResto, saisirCommandeLegume, rafraichirJournalier } from "./actions";

beforeEach(() => { for (const f of Object.values(m)) f.mockClear(); });

describe("actions de la grille Commande", () => {
  it("une case = une écriture, sans revalidation de page", async () => {
    expect(await saisirCommandeResto("art1", "2026-09-21", 2.5)).toEqual({ ok: true });
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.upsert.mock.calls[0]).toEqual([expect.objectContaining({ update: { quantite: 2.5 } })]);
    expect(await saisirCommandeLegume("Tomate", "2026-09-21", 3)).toEqual({ ok: true });
    expect(m.upsertLeg).toHaveBeenCalledTimes(1);
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("0 (case vidée) supprime la ligne de commande", async () => {
    await saisirCommandeResto("art1", "2026-09-21", 0);
    await saisirCommandeLegume("Tomate", "2026-09-21", 0);
    expect(m.deleteMany).toHaveBeenCalledTimes(1);
    expect(m.deleteManyLeg).toHaveBeenCalledTimes(1);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("une entrée invalide revient en erreur lisible (affichée sur la case), sans rien écrire", async () => {
    expect(await saisirCommandeResto("art1", "21/09/2026", 2)).toEqual({ erreur: "Date de commande invalide." });
    expect(await saisirCommandeResto("art1", "2026-09-21", -1)).toEqual({ erreur: "Quantité invalide." });
    expect(await saisirCommandeResto("art1", "2026-09-21", Number.NaN)).toEqual({ erreur: "Quantité invalide." });
    expect(await saisirCommandeResto("", "2026-09-21", 1)).toEqual({ erreur: "Article manquant." });
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it("rafraichirJournalier revalide la page, une fois", async () => {
    await rafraichirJournalier();
    expect(m.revalidatePath).toHaveBeenCalledTimes(1);
    expect(m.revalidatePath).toHaveBeenCalledWith("/stock/journalier");
  });
});
