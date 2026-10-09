import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { LeaveStatus, PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

/**
 * ACTIONS GROUPÉES DE L'ÉCRAN CONGÉS (refonte 2026-10-09). Les droits sont ceux de l'écran d'avant :
 * approuver, refuser et supprimer = Direction (ADMIN) seule ; un Responsable (MANAGER) est refusé AVANT
 * toute écriture. La suppression en lot est la suppression unitaire répétée : une trace d'audit par
 * demande, un échec nommé sans bloquer les autres. Le `requireRole` est le VRAI (pas de bouchon).
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction" } as { id: string; role: string; nom: string } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/storage", () => ({ televerserFichier: async () => "/fichiers/x.png", lireFichier: async () => null }));

const { approuverCongesEnLot, refuserCongesEnLot, supprimerCongesEnLot, supprimerConge, approuverCongeFormulaire } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId = "";
let n = 0;

const demande = (statut: LeaveStatus, jourDebut = "2026-11-03") =>
  prisma.leaveRequest.create({ data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date(jourDebut), dateFin: new Date(jourDebut), nbJours: 1, statut } }).then((d) => d.id);
const statutDe = async (id: string) => (await prisma.leaveRequest.findUnique({ where: { id } }))?.statut ?? null;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "direction.lots@test.pef", nom: "Direction", role: "ADMIN" } })).id;
  empId = (await prisma.employee.create({
    data: { matricule: `LOT-${++n}`, nom: "Salarié Lot", sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" },
  })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Congés — actions groupées : droits", () => {
  it("un Responsable est refusé pour approuver, refuser et supprimer en lot : rien n'est écrit", async () => {
    const [a, b, c] = [await demande("EN_ATTENTE"), await demande("EN_ATTENTE"), await demande("APPROUVE")];
    const direction = A.user;
    A.user = { ...direction, role: "MANAGER" };
    try {
      await expect(approuverCongesEnLot([a, b])).rejects.toThrow(/rôle insuffisant/);
      await expect(refuserCongesEnLot([a, b])).rejects.toThrow(/rôle insuffisant/);
      await expect(supprimerCongesEnLot([a, b, c])).rejects.toThrow(/rôle insuffisant/);
    } finally { A.user = direction; }
    expect([await statutDe(a), await statutDe(b), await statutDe(c)]).toEqual(["EN_ATTENTE", "EN_ATTENTE", "APPROUVE"]);
  });
});

describe("Congés — actions groupées : effets", () => {
  it("approuver en lot : seules les demandes EN ATTENTE passent, les autres sont laissées telles quelles", async () => {
    const [att, refusee] = [await demande("EN_ATTENTE"), await demande("REFUSE")];
    const r = await approuverCongesEnLot([att, refusee]);
    expect(r).toEqual({ traitees: 1, echecs: [] });
    expect(await statutDe(att)).toBe("APPROUVE");
    expect(await statutDe(refusee)).toBe("REFUSE");
  });

  it("refuser en lot : EN ATTENTE → REFUSÉ, une approbation existante n'est pas touchée", async () => {
    const [att, appr] = [await demande("EN_ATTENTE"), await demande("APPROUVE")];
    const r = await refuserCongesEnLot([att, appr]);
    expect(r).toEqual({ traitees: 1, echecs: [] });
    expect(await statutDe(att)).toBe("REFUSE");
    expect(await statutDe(appr)).toBe("APPROUVE");
  });

  it("supprimer en lot : les demandes disparaissent, UNE trace d'audit par demande, une id inconnue est ignorée", async () => {
    const ids = [await demande("EN_ATTENTE"), await demande("REFUSE"), await demande("APPROUVE")];
    const r = await supprimerCongesEnLot([...ids, ids[0], "00000000-0000-0000-0000-000000000000"]);
    expect(r).toEqual({ traitees: 3, echecs: [] });
    for (const id of ids) expect(await statutDe(id)).toBeNull();
    const traces = await prisma.journalAudit.findMany({ where: { entite: "LeaveRequest", champ: "suppression", entiteId: { in: ids } } });
    expect(traces).toHaveLength(3);
    expect(traces.every((t) => t.userId === A.user.id && /Salarié Lot/.test(t.ancienneValeur ?? ""))).toBe(true);
  });

  it("supprimer en lot une demande approuvée retire ses codes de la feuille de présence (comme l'unitaire)", async () => {
    const id = await demande("EN_ATTENTE", "2026-12-08");
    await approuverCongesEnLot([id]); // pose les codes de présence du jour
    const avant = await prisma.attendance.count({ where: { employeeId: empId, date: new Date("2026-12-08") } });
    expect(avant).toBe(1);
    await supprimerCongesEnLot([id]);
    expect(await prisma.attendance.count({ where: { employeeId: empId, date: new Date("2026-12-08") } })).toBe(0);
  });

  it("supprimer en lot : plus de 200 demandes sont refusées EN BLOC (message clair, rien supprimé)", async () => {
    const id = await demande("EN_ATTENTE");
    const r = await supprimerCongesEnLot([id, ...Array.from({ length: 200 }, (_, i) => `inconnu-${i}`)]);
    expect(r.traitees).toBe(0);
    expect(r.echecs[0]).toContain("201 demandes sélectionnées, 200 au plus");
    expect(await statutDe(id)).toBe("EN_ATTENTE");
  });

  it("la suppression et le retrait des codes de présence sont UNE transaction : si la suppression échoue, les codes restent", async () => {
    const id = await demande("EN_ATTENTE", "2026-12-15");
    await approuverCongesEnLot([id]);
    expect(await prisma.attendance.count({ where: { employeeId: empId, date: new Date("2026-12-15") } })).toBe(1);
    // Journal d'audit impossible (utilisateur inexistant) : la transaction échoue APRÈS le retrait des codes → tout est annulé.
    const direction = A.user;
    A.user = { ...direction, id: "00000000-0000-0000-0000-00000000dead" };
    try {
      await expect(supprimerConge(id)).rejects.toThrow();
    } finally { A.user = direction; }
    expect(await statutDe(id)).toBe("APPROUVE");
    expect(await prisma.attendance.count({ where: { employeeId: empId, date: new Date("2026-12-15") } })).toBe(1);
  });

  it("l'échec d'approbation unitaire garde TOUS les filtres de la liste dans l'adresse de retour", async () => {
    // Demande introuvable : `approuverConge` rend une erreur, le formulaire redirige avec les filtres.
    await expect(
      approuverCongeFormulaire("00000000-0000-0000-0000-000000000000", { statut: "EN_ATTENTE", q: "lot", quand: "a-venir", mois: "2026-11", groupe: "mois", page: "2", par: "100" }),
    ).rejects.toThrow(/REDIRECT \/conges\?statut=EN_ATTENTE&q=lot&quand=a-venir&mois=2026-11&groupe=mois&page=2&par=100&erreurDecision=/);
  });
});
