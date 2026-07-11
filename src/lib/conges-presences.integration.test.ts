import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Synchro congé approuvé → grille Présences : codes posés sur les jours ouvrables uniquement
// (jamais dimanche/férié), heures pré-remplies retirées, S pour un type à 0 %, retrait ciblé.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { poserCodesConge, retirerCodesConge } = await import("@/lib/conges-presences");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const e = await prisma.employee.create({
    data: {
      matricule: "TS01-PEF", nom: "Test Sync", sexe: "F", etatCivil: "Célibataire", poste: "Test",
      secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 100, dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  empId = e.id;
  await prisma.typeConge.createMany({ data: [
    { nom: "Congé annuel", tauxPct: 100 },
    { nom: "Congé sans solde", tauxPct: 0 },
  ] });
  // Férié le jeudi 9 juillet ; le dimanche 5 juillet tombe dans la plage.
  await prisma.jourFerie.create({ data: { date: new Date("2026-07-09"), designation: "Férié test", annee: 2026 } });
  // Heures pré-remplies sur un jour du congé (doivent disparaître).
  await prisma.overtimeEntry.create({ data: { employeeId: empId, date: new Date("2026-07-07"), heuresTravaillees: 8 } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("poserCodesConge / retirerCodesConge", () => {
  it("pose C sur les jours ouvrables seulement, retire les heures ; S pour un type 0 % ; retrait ciblé", async () => {
    // Congé sam. 4 → ven. 10 juillet : dimanche 5 et férié 9 exclus → 5 jours C (4,6,7,8,10).
    const r = await poserCodesConge(empId, new Date("2026-07-04"), new Date("2026-07-10"), "Congé annuel");
    expect(r.code).toBe("C");
    expect(r.poses).toBe(5);
    const codes = await prisma.attendance.findMany({ where: { employeeId: empId }, orderBy: { date: "asc" } });
    expect(codes.map((a) => a.date.toISOString().slice(0, 10))).toEqual(["2026-07-04", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-10"]);
    expect(codes.every((a) => a.code === "C")).toBe(true);
    // Les heures pré-remplies du 7 ont été retirées.
    expect(await prisma.overtimeEntry.count({ where: { employeeId: empId } })).toBe(0);

    // Type sans solde → S.
    const r2 = await poserCodesConge(empId, new Date("2026-07-13"), new Date("2026-07-13"), "Congé sans solde");
    expect(r2.code).toBe("S");

    // Retrait : seule la plage visée est nettoyée, un P manuel n'est pas touché.
    await prisma.attendance.create({ data: { employeeId: empId, date: new Date("2026-07-11"), code: "P" } });
    const retires = await retirerCodesConge(empId, new Date("2026-07-04"), new Date("2026-07-13"));
    expect(retires).toBe(6); // 5 C + 1 S
    const restants = await prisma.attendance.findMany({ where: { employeeId: empId } });
    expect(restants).toHaveLength(1);
    expect(restants[0].code).toBe("P");
  }, 60_000);
});
