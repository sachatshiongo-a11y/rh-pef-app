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

const { joursEnConge, joursDeReposSelonModele } = await import("@/lib/conges-couverture");
const { pariteSemaine } = await import("@/app/(app)/planning/creneaux");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let empModele: string; // modèle lun→ven (couche 0) — samedi = repos
let empParite: string; // samedi une semaine sur deux (couche parité)

const SAM_1 = "2026-07-11"; // deux samedis consécutifs → parités opposées
const SAM_2 = "2026-07-18";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const baseEmp = {
    sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle",
    categorie: "BRIGADE" as const, salaireMensuel: 100, dateEmbauche: new Date("2025-01-01"), contrat: "CDD" as const,
  };
  const e = await prisma.employee.create({ data: { ...baseEmp, matricule: "TT01-PEF", nom: "Test Congé" } });
  empId = e.id;
  await prisma.leaveRequest.create({
    data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-07-06"), dateFin: new Date("2026-07-10"), nbJours: 5, statut: "APPROUVE" },
  });
  // Une demande EN_ATTENTE ne doit PAS bloquer.
  await prisma.leaveRequest.create({
    data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-07-20"), dateFin: new Date("2026-07-22"), nbJours: 3, statut: "EN_ATTENTE" },
  });

  // Modèles hebdo pour joursDeReposSelonModele (empId n'en a AUCUN : jamais filtré).
  const [a, c] = await Promise.all([
    prisma.employee.create({ data: { ...baseEmp, matricule: "TR01-PEF", nom: "Test Repos Modele" } }),
    prisma.employee.create({ data: { ...baseEmp, matricule: "TR02-PEF", nom: "Test Parite" } }),
  ]);
  empModele = a.id; empParite = c.id;
  const shift = await prisma.shift.create({ data: { nom: "Test Caisse", heureDebut: "10:00", heureFin: "18:00" } });
  await prisma.planningModele.createMany({
    data: [1, 2, 3, 4, 5].map((jour) => ({ employeeId: empModele, jour, semaine: 0, shiftId: shift.id })),
  });
  await prisma.planningModele.create({
    data: { employeeId: empParite, jour: 6, semaine: pariteSemaine(new Date(SAM_1 + "T00:00:00Z")), shiftId: shift.id },
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

describe("joursDeReposSelonModele — repos du modèle hebdo (saisies en lot)", () => {
  it("marque repos les jours absents du modèle, jamais un jour travaillé ni un employé sans modèle", async () => {
    const repos = await joursDeReposSelonModele([
      { employeeId: empModele, date: SAM_1 }, // samedi hors modèle → repos
      { employeeId: empModele, date: "2026-07-13" }, // lundi au modèle → travaillé
      { employeeId: empId, date: SAM_1 }, // aucun modèle → jamais filtré
    ]);
    expect(repos.has(`${empModele}|${SAM_1}`)).toBe(true);
    expect(repos.has(`${empModele}|2026-07-13`)).toBe(false);
    expect(repos.has(`${empId}|${SAM_1}`)).toBe(false);
  }, 60_000);

  it("respecte la couche de parité (semaine A/B) : samedi travaillé une semaine sur deux", async () => {
    const repos = await joursDeReposSelonModele([
      { employeeId: empParite, date: SAM_1 }, // parité du modèle → travaillé
      { employeeId: empParite, date: SAM_2 }, // parité opposée → repos
    ]);
    expect(repos.has(`${empParite}|${SAM_1}`)).toBe(false);
    expect(repos.has(`${empParite}|${SAM_2}`)).toBe(true);
  }, 60_000);
});
