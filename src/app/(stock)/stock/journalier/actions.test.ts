// Appels serveur par case de la grille Commande : une écriture, et AUCUNE revalidation de page
// (avant le 2026-09-24 : 1 revalidatePath par case = toute la page recalculée — 3 requêtes
// Prisma — et renvoyée au navigateur). La revalidation n'a lieu qu'une fois par rafale.
// Depuis l'audit du 10/10/2026 : période clôturée refusée, journal avant → après, auteur de la saisie
// (la preuve sur une vraie base est dans fiche.integration / saisies-restaurant.integration).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  upsert: vi.fn(async () => ({})),
  deleteMany: vi.fn(async () => ({ count: 1 })),
  findUnique: vi.fn(async () => null as { quantite: unknown } | null),
  upsertLeg: vi.fn(async () => ({})),
  deleteManyLeg: vi.fn(async () => ({ count: 1 })),
  findUniqueLeg: vi.fn(async () => null as { quantite: unknown } | null),
  journal: vi.fn(async () => ({ count: 1 })),
  cloture: vi.fn(async () => null as { annee: number; mois: number } | null),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/auth", () => ({ verifySession: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireModule: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const client = {
    commandeResto: { upsert: m.upsert, deleteMany: m.deleteMany, findUnique: m.findUnique },
    commandeLegumeResto: { upsert: m.upsertLeg, deleteMany: m.deleteManyLeg, findUnique: m.findUniqueLeg },
    journalAudit: { createMany: m.journal },
    clotureStock: { findFirst: m.cloture },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

import { saisirCommandeResto, saisirCommandeLegume, rafraichirJournalier } from "./actions";

beforeEach(() => { for (const f of Object.values(m)) f.mockClear(); m.findUnique.mockResolvedValue(null); m.findUniqueLeg.mockResolvedValue(null); m.cloture.mockResolvedValue(null); });

describe("actions de la grille Commande", () => {
  it("une case = une écriture, sans revalidation de page", async () => {
    expect(await saisirCommandeResto("art1", "2026-09-21", 2.5)).toEqual({ ok: true });
    expect(m.upsert).toHaveBeenCalledTimes(1);
    expect(m.upsert.mock.calls[0]).toEqual([expect.objectContaining({ update: { quantite: 2.5, saisiParId: "u1" } })]);
    expect(await saisirCommandeLegume("Tomate", "2026-09-21", 3)).toEqual({ ok: true });
    expect(m.upsertLeg).toHaveBeenCalledTimes(1);
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("0 (case vidée) supprime la ligne de commande quand elle existe", async () => {
    m.findUnique.mockResolvedValue({ quantite: new Prisma.Decimal(2) });
    m.findUniqueLeg.mockResolvedValue({ quantite: new Prisma.Decimal(1) });
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

  it("une période de stock clôturée est en lecture seule : rien n'est écrit ni journalisé", async () => {
    m.cloture.mockResolvedValue({ annee: 2026, mois: 9 });
    const r = await saisirCommandeResto("art1", "2026-09-21", 2);
    expect(r).toEqual({ erreur: expect.stringContaining("La période 09/2026 est clôturée") });
    expect(await saisirCommandeLegume("Tomate", "2026-09-21", 2)).toEqual({ erreur: expect.stringContaining("clôturée") });
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.upsertLeg).not.toHaveBeenCalled();
    expect(m.journal).not.toHaveBeenCalled();
  });

  it("chaque changement est journalisé (avant → après) ; la même quantité ne change rien", async () => {
    m.findUnique.mockResolvedValue({ quantite: new Prisma.Decimal(2) });
    await saisirCommandeResto("art1", "2026-09-21", 5);
    expect(m.journal).toHaveBeenCalledWith({ data: [{ entite: "CommandeResto", entiteId: "art1_2026-09-21", champ: "quantite", ancienneValeur: "2", nouvelleValeur: "5", userId: "u1" }] });
    m.journal.mockClear(); m.upsert.mockClear();
    await saisirCommandeResto("art1", "2026-09-21", 2); // inchangé
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.journal).not.toHaveBeenCalled();
  });

  it("rafraichirJournalier revalide la page, une fois", async () => {
    await rafraichirJournalier();
    expect(m.revalidatePath).toHaveBeenCalledTimes(1);
    expect(m.revalidatePath).toHaveBeenCalledWith("/stock/journalier");
  });
});
