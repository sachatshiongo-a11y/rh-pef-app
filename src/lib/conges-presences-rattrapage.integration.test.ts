import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// RATTRAPAGE DES CODES DE CONGÉ (grille Présences) — comportement figé sur une base éphémère, et NOMBRE DE LECTURES :
// la grille l'appelle à CHAQUE affichage du mois courant. Avant le 13/10/2026, une lecture par congé approuvé, en série
// (≈ 120 allers-retours sur un jeu de 60 salariés × 3 ans de congés) : la moitié du temps de la page Présences.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, lectures: 0 }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      if (p === "attendance") {
        return new Proxy(v as object, {
          get: (cible, m) => {
            const f = (cible as Record<string | symbol, unknown>)[m];
            if (typeof f !== "function") return f;
            return (...a: unknown[]) => { if (m === "findMany") H.lectures++; return (f as (...x: unknown[]) => unknown).apply(cible, a); };
          },
        });
      }
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { rattraperCodesConges } = await import("./conges-presences");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
let seq = 0;
async function employe() {
  return (await prisma.employee.create({
    data: { matricule: `R-${++seq}`, nom: `Salarié ${seq}`, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: d("2024-01-01"), contrat: "CDI" },
  })).id;
}
const conge = (employeeId: string, debut: string, fin: string, type = "Congé annuel") =>
  prisma.leaveRequest.create({ data: { employeeId, type, dateDebut: d(debut), dateFin: d(fin), nbJours: 1, statut: "APPROUVE" } });
const codes = async (employeeId: string) =>
  (await prisma.attendance.findMany({ where: { employeeId }, orderBy: { date: "asc" }, select: { date: true, code: true } }))
    .map((a) => `${a.date.toISOString().slice(0, 10)}:${a.code}`);

describe("rattraperCodesConges", () => {
  beforeAll(async () => {
    ({ prisma, fermer } = await creerBaseTest());
    H.client = prisma;
  }, 120_000);
  afterAll(async () => { await fermer?.(); });

  it("pose les codes manquants, sans toucher aux codes présents ni aux mois figés, en un nombre de lectures borné", async () => {
    await prisma.typeConge.createMany({ data: [{ nom: "Congé annuel", tauxPct: 100 }, { nom: "Sans solde", tauxPct: 0 }] });
    await prisma.jourFerie.create({ data: { date: d("2026-11-03"), designation: "Férié test", annee: 2026 } });
    await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2850 } }); // septembre figé

    const a = await employe(), b = await employe(), c = await employe();
    // A : congé de novembre (lun 2 → sam 7), avec un férié le 3 et un code déjà saisi le 4 (gardé tel quel) + des heures le 5.
    await conge(a, "2026-11-02", "2026-11-07");
    await prisma.attendance.create({ data: { employeeId: a, date: d("2026-11-04"), code: "M" } });
    await prisma.overtimeEntry.create({ data: { employeeId: a, date: d("2026-11-05"), heuresTravaillees: 8 } });
    await prisma.overtimeEntry.create({ data: { employeeId: a, date: d("2026-11-20"), heuresTravaillees: 8 } }); // hors congé : gardé
    // B : sans solde (code S), à cheval sur septembre (figé) et octobre.
    await conge(b, "2026-09-29", "2026-10-02", "Sans solde");
    // C : deux congés qui se chevauchent (le 10 et le 11) : chaque jour n'est posé qu'une fois.
    await conge(c, "2026-12-07", "2026-12-11");
    await conge(c, "2026-12-10", "2026-12-12");
    // Un congé refusé n'est jamais posé.
    await prisma.leaveRequest.create({ data: { employeeId: c, type: "Congé annuel", dateDebut: d("2026-12-14"), dateFin: d("2026-12-14"), nbJours: 1, statut: "REFUSE" } });
    // Beaucoup d'autres congés approuvés, déjà posés (régime de croisière) : ils ne doivent pas coûter une lecture chacun.
    for (let k = 0; k < 30; k++) {
      const e = await employe();
      await conge(e, "2026-08-03", "2026-08-07");
      await prisma.attendance.createMany({ data: ["03", "04", "05", "06", "07"].map((j) => ({ employeeId: e, date: d(`2026-08-${j}`), code: "C" as const })) });
    }

    H.lectures = 0;
    const total = await rattraperCodesConges();
    expect(H.lectures).toBeLessThanOrEqual(2);

    expect(await codes(a)).toEqual(["2026-11-02:C", "2026-11-04:M", "2026-11-05:C", "2026-11-06:C", "2026-11-07:C"]);
    expect((await prisma.overtimeEntry.findMany({ where: { employeeId: a }, select: { date: true } })).map((o) => o.date.toISOString().slice(0, 10))).toEqual(["2026-11-20"]);
    expect(await codes(b)).toEqual(["2026-10-01:S", "2026-10-02:S"]);
    expect(await codes(c)).toEqual(["2026-12-07:C", "2026-12-08:C", "2026-12-09:C", "2026-12-10:C", "2026-12-11:C", "2026-12-12:C"]);
    expect(total).toBe(4 + 2 + 6);

    // Idempotent : un second passage ne pose plus rien.
    expect(await rattraperCodesConges()).toBe(0);
  });
});
