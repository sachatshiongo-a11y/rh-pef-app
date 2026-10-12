import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Audit paie du 2026-10-10 (#14) : le serveur acceptait 75 h ou -3 h pour une journée (l'écran seul
// bornait) — heures supp. gonflées, ou heures normales retranchées de la paie.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: "u", role: "ADMIN", nom: "Direction" }), requireRole: () => {}, requireModule: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saisirHeures, saisirHeuresEnLot } = await import("./actions");
let prisma: PrismaClient; let fermer: () => Promise<void>; let empId = "";

beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "u", email: "d@pef.cd", nom: "Direction", role: "ADMIN" } });
  // Mois RH courant = septembre 2026, le mois saisi : un mois antérieur au mois RH courant est en lecture seule
  // (2026-10-12) ; sans Config, ce serait le mois de l'horloge.
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  empId = (await prisma.employee.create({ data: {
    matricule: "BR1", nom: "Cuisine", sexe: "F", etatCivil: "C", poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel: 300, heuresHebdomadaires: 48, heuresParJour: 8, dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI" } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("heures d'une journée : entre 0 et 24 h, sinon refus et rien d'écrit", () => {
  it("75 h et -3 h refusées ; 24 h et 7,5 h acceptées", async () => {
    await expect(saisirHeures(empId, "2026-09-03", "75")).rejects.toThrow("Heures « 75 » le 03/09 impossibles : une journée compte entre 0 et 24 heures. Rien n'a été enregistré.");
    await expect(saisirHeures(empId, "2026-09-03", "-3")).rejects.toThrow(/entre 0 et 24 heures/);
    expect(await prisma.overtimeEntry.count()).toBe(0);
    await saisirHeures(empId, "2026-09-03", "7,5");
    await saisirHeures(empId, "2026-09-04", "24");
    expect((await prisma.overtimeEntry.findMany({ orderBy: { date: "asc" } })).map((h) => Number(h.heuresTravaillees))).toEqual([7.5, 24]);
  });

  it("en lot : une seule valeur hors bornes refuse tout le lot, avant la première écriture", async () => {
    await expect(saisirHeuresEnLot([
      { employeeId: empId, date: "2026-09-07", heures: "8" },
      { employeeId: empId, date: "2026-09-08", heures: "30" },
    ])).rejects.toThrow(/le 08\/09 impossibles/);
    expect(await prisma.overtimeEntry.count({ where: { date: new Date("2026-09-07T00:00:00Z") } })).toBe(0);
  });
});
