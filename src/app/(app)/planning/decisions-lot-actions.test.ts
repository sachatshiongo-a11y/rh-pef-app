// Décisions groupées sur les shifts : chaque demande passe par l'action individuelle ; un refus (redirection
// ?erreur= du verrou de paie) est NOMMÉ et n'arrête pas les autres ; au-delà du plafond, rien n'est fait.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  approuverChangementShift: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  refuserChangementShift: vi.fn(async () => undefined),
  approuverEchange: vi.fn(async () => undefined),
  refuserEchange: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ verifySession: vi.fn(async () => ({ id: "u", role: "ADMIN" })), requireRole: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    demandeChangementShift: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, employee: { nom: `Nom ${id}` } }))) },
    echangeCreneau: { findMany: vi.fn(async () => []) },
    employee: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("./actions", () => m);

import { approuverChangementsEnLot, refuserEchangesEnLot } from "./decisions-lot-actions";

const refus = (message: string) => Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;/a-valider?erreur=${encodeURIComponent(message)};307;` });
beforeEach(() => vi.clearAllMocks());

describe("approuverChangementsEnLot", () => {
  it("traite toute la sélection, une par une, par l'action individuelle", async () => {
    const r = await approuverChangementsEnLot(["a", "b", "a"]);
    expect(m.approuverChangementShift.mock.calls.map((c) => c[0])).toEqual(["a", "b"]); // doublon écarté
    expect(r).toEqual({ traitees: 2, echecs: [] });
  });

  it("une demande refusée par le verrou de paie est nommée, les autres passent", async () => {
    m.approuverChangementShift.mockImplementationOnce(async () => { throw refus("La paie d'octobre est validée : créneau non modifiable."); });
    const r = await approuverChangementsEnLot(["a", "b"]);
    expect(r.traitees).toBe(1);
    expect(r.echecs).toEqual(["Nom a : La paie d'octobre est validée : créneau non modifiable."]);
    expect(m.approuverChangementShift).toHaveBeenCalledTimes(2);
  });

  it("une erreur inattendue ne montre pas son texte brut", async () => {
    const espion = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.approuverChangementShift.mockImplementationOnce(async () => { throw new TypeError("Cannot read properties of null (reading 'x')"); });
    const r = await approuverChangementsEnLot(["a"]);
    espion.mockRestore();
    expect(r.echecs[0]).toContain("Erreur inattendue");
    expect(r.echecs[0]).not.toContain("Cannot read");
  });

  it("au-delà de 100 demandes : rien n'est fait, la raison est dite", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `d${i}`);
    const r = await approuverChangementsEnLot(ids);
    expect(r.traitees).toBe(0);
    expect(r.echecs[0]).toContain("100 demandes au plus");
    expect(m.approuverChangementShift).not.toHaveBeenCalled();
  });
});

describe("refuserEchangesEnLot", () => {
  it("passe par refuserEchange", async () => {
    const r = await refuserEchangesEnLot(["x"]);
    expect(m.refuserEchange).toHaveBeenCalledWith("x");
    expect(r.traitees).toBe(1);
  });
});
