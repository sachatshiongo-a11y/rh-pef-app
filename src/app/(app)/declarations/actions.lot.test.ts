// Marquer plusieurs organismes d'un coup : mêmes règles que le marquage individuel, refus nommés, bordereau calculé une fois.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  bordereau: vi.fn(),
  upsert: vi.fn(async () => undefined),
  existants: new Map<string, string>(),
}));
vi.mock("@/lib/auth", () => ({ verifySession: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireRole: vi.fn() }));
vi.mock("@/lib/declarations", () => ({ calculerDeclarationsMois: m.bordereau }));
vi.mock("@/lib/audit", () => ({ journaliser: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => Promise<void>) => cb({
      declarationTaxe: {
        findUnique: async ({ where }: { where: { type_mois_annee: { type: string } } }) => {
          const statut = m.existants.get(where.type_mois_annee.type);
          return statut ? { statut } : null;
        },
        upsert: m.upsert,
      },
    }),
  },
}));

import { marquerDeclarationsEnLot } from "./actions";

const ligne = (type: string) => ({ type, libelle: type, recalculUSD: 10, recalculCDF: 28000, echeance: new Date("2026-11-15") });
beforeEach(() => {
  vi.clearAllMocks();
  m.existants.clear();
  m.bordereau.mockResolvedValue({ provisoire: false, nbNonValides: 0, nbBulletins: 5, lignes: [ligne("CNSS"), ligne("IPR"), ligne("ONEM")] });
});

describe("marquerDeclarationsEnLot", () => {
  it("marque chaque organisme choisi, le bordereau n'est calculé qu'une fois", async () => {
    const r = await marquerDeclarationsEnLot(["CNSS", "IPR"], 10, 2026, "DECLARE");
    expect(r).toEqual({ traitees: 2, echecs: [] });
    expect(m.upsert).toHaveBeenCalledTimes(2);
    expect(m.bordereau).toHaveBeenCalledTimes(1);
  });

  it("une taxe déjà payée est refusée et nommée ; les autres passent", async () => {
    m.existants.set("IPR", "PAYE");
    const r = await marquerDeclarationsEnLot(["CNSS", "IPR"], 10, 2026, "PAYE");
    expect(r).toEqual({ traitees: 1, echecs: ["IPR : Cette déclaration est déjà marquée payée."] });
  });

  it("paie non validée : aucun premier marquage, chaque organisme est refusé avec la raison", async () => {
    m.bordereau.mockResolvedValue({ provisoire: true, nbNonValides: 2, nbBulletins: 5, lignes: [ligne("CNSS")] });
    const r = await marquerDeclarationsEnLot(["CNSS"], 10, 2026, "DECLARE");
    expect(r).toMatchObject({ traitees: 0 });
    expect((r as { echecs: string[] }).echecs[0]).toContain("Validez la paie du mois d'abord");
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it("aucune paie ce mois : le refus lisible revient comme { erreur }", async () => {
    m.bordereau.mockResolvedValue(null);
    expect(await marquerDeclarationsEnLot(["CNSS"], 10, 2026, "DECLARE")).toEqual({ erreur: "Aucune paie calculée pour ce mois." });
  });

  it("sélection vide : rien", async () => {
    expect(await marquerDeclarationsEnLot([], 10, 2026, "DECLARE")).toEqual({ traitees: 0, echecs: [] });
  });
});
