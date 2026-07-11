import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Vérifie que les saisies automatiques ignorent bien les jours couverts par un congé APPROUVÉ.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { joursEnConge } = await import("@/lib/conges-couverture");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const e = await prisma.employee.create({
    data: {
      matricule: "TT01-PEF", nom: "Test Congé", sexe: "F", etatCivil: "Célibataire", poste: "Test",
      secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 100, dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  empId = e.id;
  await prisma.leaveRequest.create({
    data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-07-06"), dateFin: new Date("2026-07-10"), nbJours: 5, statut: "APPROUVE" },
  });
  // Une demande EN_ATTENTE ne doit PAS bloquer.
  await prisma.leaveRequest.create({
    data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-07-20"), dateFin: new Date("2026-07-22"), nbJours: 3, statut: "EN_ATTENTE" },
  });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("joursEnConge — couverture des congés approuvés", () => {
  it("couvre les jours du congé approuvé (bornes incluses), pas les autres ni les demandes en attente", async () => {
    const entrees = ["2026-07-05", "2026-07-06", "2026-07-08", "2026-07-10", "2026-07-11", "2026-07-21"]
      .map((date) => ({ employeeId: empId, date }));
    const couverts = await joursEnConge(entrees);
    expect(couverts.has(`${empId}|2026-07-05`)).toBe(false); // veille
    expect(couverts.has(`${empId}|2026-07-06`)).toBe(true); // 1er jour
    expect(couverts.has(`${empId}|2026-07-08`)).toBe(true); // milieu
    expect(couverts.has(`${empId}|2026-07-10`)).toBe(true); // dernier jour
    expect(couverts.has(`${empId}|2026-07-11`)).toBe(false); // lendemain
    expect(couverts.has(`${empId}|2026-07-21`)).toBe(false); // demande seulement EN_ATTENTE
  }, 60_000);
});
