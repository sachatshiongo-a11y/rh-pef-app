import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { LeaveStatus, PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

/**
 * LE MOTIF DE REFUS (décision Direction 2026-10-09) : obligatoire (≤ 500 caractères) pour tout refus, à
 * l'unité comme en lot ; stocké ; au journal d'audit ; repris dans la notification au salarié ; imprimé sur
 * le PDF — qui dit « Approuvé par la Direction » SANS le nom de la personne. Le vrai `requireRole`.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Tshiongo" } as { id: string; role: string; nom: string } }));
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

const { refuserConge, refuserCongesEnLot, approuverConge, approuverCongesEnLot } = await import("./actions");
const { genererDemandeCongePdf } = await import("@/lib/pdf/demande-conge-buffer");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId = "";
let compteSalarieId = "";

const demande = (statut: LeaveStatus = "EN_ATTENTE", jour = "2026-11-03") =>
  prisma.leaveRequest.create({ data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date(jour), dateFin: new Date(jour), nbJours: 1, statut, ...(statut !== "EN_ATTENTE" ? { approuveParId: A.user.id } : {}) } }).then((d) => d.id);
const relire = (id: string) => prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
async function textePdf(id: string): Promise<string> {
  const r = await genererDemandeCongePdf(id);
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(r!.buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  await seedParametresLegaux(prisma);
  await prisma.typeConge.create({ data: { nom: "Congé annuel", compteDansSolde: true } });
  A.user.id = (await prisma.user.create({ data: { email: "direction.refus@test.pef", nom: "Sacha Tshiongo", role: "ADMIN" } })).id;
  empId = (await prisma.employee.create({
    data: { matricule: "RF-1", nom: "Salarié Refus", sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" },
  })).id;
  compteSalarieId = (await prisma.user.create({ data: { email: "salarie.refus@test.pef", nom: "Salarié Refus", role: "EMPLOYE", employeeId: empId } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("refus à l'unité : le motif est obligatoire", () => {
  it("sans motif (vide, espaces, absent), rien n'est écrit et la raison est RENDUE", async () => {
    const id = await demande();
    for (const brut of ["", "   ", undefined as unknown as string]) {
      expect(await refuserConge(id, brut)).toEqual({ erreur: "Un motif est obligatoire pour refuser une demande de congé." });
    }
    expect((await relire(id)).statut).toBe("EN_ATTENTE");
    expect(await prisma.journalAudit.count({ where: { entiteId: id } })).toBe(0);
  });

  it("au-delà de 500 caractères : refusé, lisible ; 500 pile : accepté", async () => {
    const id = await demande();
    const r = await refuserConge(id, "x".repeat(501));
    expect(r.erreur).toContain("trop long (501 caractères, 500 au plus)");
    expect((await relire(id)).statut).toBe("EN_ATTENTE");
    expect(await refuserConge(id, "x".repeat(500))).toEqual({});
    expect((await relire(id)).motifRefus).toHaveLength(500);
  });

  it("un Responsable est refusé AVANT toute écriture", async () => {
    const id = await demande();
    const direction = A.user;
    A.user = { ...direction, role: "MANAGER" };
    try { await expect(refuserConge(id, "Motif")).rejects.toThrow(/rôle insuffisant/); } finally { A.user = direction; }
    expect((await relire(id)).statut).toBe("EN_ATTENTE");
  });

  it("le motif est rogné, stocké sur la demande, tracé au journal d'audit, repris dans la notification au salarié", async () => {
    const id = await demande("EN_ATTENTE", "2026-11-10");
    expect(await refuserConge(id, "  Effectif insuffisant ce mois-là  ")).toEqual({});
    const d = await relire(id);
    expect(d.statut).toBe("REFUSE");
    expect(d.motifRefus).toBe("Effectif insuffisant ce mois-là");
    const trace = await prisma.journalAudit.findFirst({ where: { entiteId: id, champ: "motifRefus" } });
    expect(trace?.nouvelleValeur).toBe("Effectif insuffisant ce mois-là");
    expect(trace?.userId).toBe(A.user.id);
    const notif = await prisma.notification.findFirstOrThrow({ where: { destinataireUserId: compteSalarieId, refId: `${id}:decision` } });
    expect(notif.message).toBe("Votre demande de congé du 10/11/2026 au 10/11/2026 est refusée : Effectif insuffisant ce mois-là");
  });

  it("refuser une demande déjà approuvée exige aussi un motif ; le solde figé est effacé comme avant", async () => {
    const id = await demande("EN_ATTENTE", "2026-11-17");
    await approuverConge(id);
    expect((await relire(id)).soldeFigeJours).not.toBeNull();
    expect((await refuserConge(id, "")).erreur).toBeTruthy();
    expect((await relire(id)).statut).toBe("APPROUVE");
    await refuserConge(id, "Erreur de saisie");
    const d = await relire(id);
    expect(d.statut).toBe("REFUSE");
    expect(d.soldeFigeJours).toBeNull();
  });

  it("une approbation ultérieure efface le motif", async () => {
    const id = await demande("EN_ATTENTE", "2026-11-24");
    await refuserConge(id, "Trop tôt");
    await approuverConge(id);
    const d = await relire(id);
    expect(d.statut).toBe("APPROUVE");
    expect(d.motifRefus).toBeNull();
  });
});

describe("refus en lot : un même motif pour la sélection", () => {
  it("sans motif : rien n'est refusé, la raison est rendue", async () => {
    const [a, b] = [await demande(), await demande()];
    expect(await refuserCongesEnLot([a, b], "")).toEqual({ traitees: 0, echecs: ["Un motif est obligatoire pour refuser une demande de congé."] });
    expect(await refuserCongesEnLot([a, b], "y".repeat(501))).toMatchObject({ traitees: 0 });
    expect([(await relire(a)).statut, (await relire(b)).statut]).toEqual(["EN_ATTENTE", "EN_ATTENTE"]);
  });

  it("avec motif : toutes les demandes en attente reçoivent le même motif, une trace d'audit chacune ; une approuvée n'est pas touchée", async () => {
    const [a, b, c] = [await demande(), await demande(), await demande("APPROUVE")];
    const r = await refuserCongesEnLot([a, b, c], "Fermeture de la salle");
    expect(r).toEqual({ traitees: 2, echecs: [] });
    expect([(await relire(a)).motifRefus, (await relire(b)).motifRefus, (await relire(c)).motifRefus]).toEqual(["Fermeture de la salle", "Fermeture de la salle", null]);
    expect(await prisma.journalAudit.count({ where: { champ: "motifRefus", entiteId: { in: [a, b] } } })).toBe(2);
  });

  it("l'approbation en lot efface un éventuel motif", async () => {
    const id = await demande("REFUSE");
    await prisma.leaveRequest.update({ where: { id }, data: { motifRefus: "Ancien motif" } });
    await prisma.leaveRequest.update({ where: { id }, data: { statut: "EN_ATTENTE" } });
    await approuverCongesEnLot([id]);
    expect((await relire(id)).motifRefus).toBeNull();
  });
});

describe("PDF de la demande", () => {
  it("refusée : « Refusé par la Direction » et le motif imprimé, sans le nom de la personne", async () => {
    const id = await demande("EN_ATTENTE", "2026-12-01");
    await refuserConge(id, "Effectif insuffisant");
    const t = await textePdf(id);
    expect(t).toContain("Refusé par la Direction");
    expect(t).toContain("Motif du refus");
    expect(t).toContain("Effectif insuffisant");
    expect(t).not.toContain("Sacha");
    expect(t).not.toContain("Traité par");
  });

  it("approuvée : « Approuvé par la Direction », jamais le nom de la personne qui a cliqué", async () => {
    const id = await demande("EN_ATTENTE", "2026-12-08");
    await approuverConge(id);
    const t = await textePdf(id);
    expect(t).toContain("Approuvé par la Direction");
    expect(t).not.toContain("Sacha");
    expect(t).not.toContain("Motif du refus");
  });

  it("ancienne demande refusée sans motif : « — »", async () => {
    const id = await demande("REFUSE", "2026-12-15");
    expect(await textePdf(id)).toMatch(/Motif du refus —/);
  });

  it("en attente : « En attente de décision »", async () => {
    expect(await textePdf(await demande("EN_ATTENTE", "2026-12-22"))).toContain("En attente de décision");
  });
});
