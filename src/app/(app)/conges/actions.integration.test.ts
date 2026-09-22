import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le serveur reste juge : une demande dont le nombre de jours soumis ne colle plus aux dates est
// REFUSÉE avec un message lisible, jamais enregistrée avec un autre nombre en silence.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
// MANAGER, pas ADMIN : pas d'auto-approbation, donc pas de codes de présence à poser dans ce test.
const A = vi.hoisted(() => ({ user: { id: "seed", role: "MANAGER", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// `formulaireLisible` redirige vers `/conges?erreur=…` : on capture l'URL au lieu de naviguer.
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { demanderConge } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const e = await prisma.employee.create({
    data: {
      matricule: "TT02-PEF", nom: "Test Écart", sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle",
      categorie: "BRIGADE", salaireMensuel: 100, dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  empId = e.id;
  // Le 30 juin est férié (indépendance) : 29 juin → 4 juillet = 5 jours ouvrables, pas 6.
  await prisma.jourFerie.create({ data: { date: new Date("2026-06-30"), designation: "Indépendance", annee: 2026 } });
}, 120_000);

afterAll(async () => { await fermer(); });

describe("demanderConge — cohérence jours soumis / jours recalculés", () => {
  it("enregistre une demande dont le nombre soumis est celui recalculé (5 j du 29/06 au 04/07, férié le 30)", async () => {
    await demanderConge(fd({ employeeId: empId, type: "Congé annuel", dateDebut: "2026-06-29", dateFin: "2026-07-04", nbJours: "5" }));
    const d = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: empId } });
    expect(Number(d.nbJours)).toBe(5);
    expect(d.statut).toBe("EN_ATTENTE");
  });

  it("refuse un nombre soumis différent, avec le message attendu, et n'enregistre rien", async () => {
    const avant = await prisma.leaveRequest.count({ where: { employeeId: empId } });
    await expect(
      demanderConge(fd({ employeeId: empId, type: "Congé annuel", dateDebut: "2026-07-06", dateFin: "2026-07-11", nbJours: "7" })),
    ).rejects.toThrow(/REDIRECT \/conges\?erreur=.*ne%20correspond%20plus/);
    expect(await prisma.leaveRequest.count({ where: { employeeId: empId } })).toBe(avant);
  });

  it("sans champ nbJours (ancien formulaire), le serveur fait foi et enregistre", async () => {
    await demanderConge(fd({ employeeId: empId, type: "Congé annuel", dateDebut: "2026-08-03", dateFin: "2026-08-08" }));
    const d = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: empId, dateDebut: new Date("2026-08-03") } });
    expect(Number(d.nbJours)).toBe(6);
  });
});
