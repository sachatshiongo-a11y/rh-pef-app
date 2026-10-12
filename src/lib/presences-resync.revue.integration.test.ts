// Relecture indépendante du recalage des heures quand le planning change (revue 2026-10-12).
// Horloge figée au 12/10/2026 : seul un jour À VENIR peut être recalé.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
const { ecrireCreneaux, PlanningVerrouilleError } = await import("./planning-ecriture");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let userId = "";
let matin = "", soir = "";
let n = 0;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ecrire = (ops: { employeeId: string; date: Date; shiftId: string | null }[], opts?: { genereAuto?: boolean }) =>
  prisma.$transaction((tx) => ecrireCreneaux(tx, userId, ops, opts), { timeout: 60_000 });
const heures = async (id: string, iso: string) => { const h = await prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId: id, date: d(iso) } } }); return h ? Number(h.heuresTravaillees) : null; };
async function emp(extra: Record<string, unknown> = {}) {
  n++;
  return (await prisma.employee.create({ data: { matricule: `RV${n}-PEF`, nom: `Revue ${n}`, sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 200, dateEmbauche: d("2025-01-06"), contrat: "CDI", heuresParJour: 8, heuresHebdomadaires: 48, ...extra } })).id;
}
async function presence(id: string, iso: string, h: number) {
  await prisma.attendance.create({ data: { employeeId: id, date: d(iso), code: "P" } });
  await prisma.overtimeEntry.create({ data: { employeeId: id, date: d(iso), heuresTravaillees: h } });
}

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
  userId = (await prisma.user.create({ data: { email: "rv@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  matin = (await prisma.shift.create({ data: { nom: "Matin", heureDebut: "08:00", heureFin: "16:00" } })).id;
  soir = (await prisma.shift.create({ data: { nom: "Soir", heureDebut: "16:00", heureFin: "22:00" } })).id;
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

describe("recalage des heures au changement de planning", () => {
  it("MOIS FIGÉ : paie VALIDÉE -> rien n'est écrit (ni créneau, ni heures, ni journal)", async () => {
    const id = await emp();
    const run = await prisma.payrollRun.upsert({ where: { mois_annee: { mois: 10, annee: 2026 } }, update: {}, create: { mois: 10, annee: 2026, tauxChangeUtilise: 2300 } });
    const m = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
    await prisma.payrollLine.create({ data: { ...m, payrollRunId: run.id, employeeId: id, statutPaiement: "VALIDE" } });
    await prisma.planningCreneau.create({ data: { employeeId: id, date: d("2026-10-20"), shiftId: matin } });
    await presence(id, "2026-10-20", 8);
    await expect(ecrire([{ employeeId: id, date: d("2026-10-20"), shiftId: soir }])).rejects.toBeInstanceOf(PlanningVerrouilleError);
    expect(await heures(id, "2026-10-20")).toBe(8);
    expect((await prisma.planningCreneau.findFirstOrThrow({ where: { employeeId: id, date: d("2026-10-20") } })).shiftId).toBe(matin);
    expect(await prisma.journalAudit.count({ where: { entiteId: `${id}_2026-10-20` } })).toBe(0);
  });

  it("journal : avant -> après, un recalage = une ligne ; planning annulé (suppression) -> retour au contrat", async () => {
    const id = await emp({ heuresParJour: 7 });
    await prisma.planningCreneau.create({ data: { employeeId: id, date: d("2026-11-03"), shiftId: matin } });
    await presence(id, "2026-11-03", 8); // = défaut (créneau matin)
    await ecrire([{ employeeId: id, date: d("2026-11-03"), shiftId: soir }]);
    expect(await heures(id, "2026-11-03")).toBe(6);
    await ecrire([{ employeeId: id, date: d("2026-11-03"), shiftId: null }]); // plus de créneau, pas de modèle -> contrat 7
    expect(await heures(id, "2026-11-03")).toBe(7);
    const j = await prisma.journalAudit.findMany({ where: { entiteId: `${id}_2026-11-03`, champ: "heuresTravaillees" }, orderBy: { date: "asc" } });
    expect(j.map((e) => [e.ancienneValeur, e.nouvelleValeur?.split(" ")[0]])).toEqual([["8", "6"], ["6", "7"]]);
  });

  it("jour PASSÉ ou en cours : heures égales à l'ancien défaut (réelles, importées, saisies) jamais recalées, journalisées « gardées »", async () => {
    const id = await emp();
    for (const j of ["2026-10-05", "2026-10-12"]) {
      await prisma.planningCreneau.create({ data: { employeeId: id, date: d(j), shiftId: matin } });
      await presence(id, j, 8); // 8 h réellement travaillées, sans Pointage
      await ecrire([{ employeeId: id, date: d(j), shiftId: soir }]); // correction du planning a posteriori
      expect(await heures(id, j)).toBe(8);
      expect(await prisma.journalAudit.count({ where: { entiteId: `${id}_${j}`, champ: "heuresGardees" } })).toBe(1);
    }
  });

  it("jour à venir : heures différentes de l'ancien défaut (saisies) gardées", async () => {
    const id = await emp();
    await prisma.planningCreneau.create({ data: { employeeId: id, date: d("2026-11-06"), shiftId: matin } });
    await presence(id, "2026-11-06", 9); // pas égal au défaut 8 : gardé
    await ecrire([{ employeeId: id, date: d("2026-11-06"), shiftId: soir }]);
    expect(await heures(id, "2026-11-06")).toBe(9);
  });

  it("pointage valable : jamais recalé", async () => {
    const id = await emp();
    await prisma.planningCreneau.create({ data: { employeeId: id, date: d("2026-11-05"), shiftId: matin } });
    await presence(id, "2026-11-05", 8);
    await prisma.pointage.create({ data: { employeeId: id, date: d("2026-11-05"), heureDebut: new Date("2026-11-05T06:00:00Z"), heureFin: new Date("2026-11-05T14:00:00Z") } });
    await ecrire([{ employeeId: id, date: d("2026-11-05"), shiftId: soir }]);
    expect(await heures(id, "2026-11-05")).toBe(8);
  });

  it("PERF : une semaine x 20 salariés (140 cellules, 100 présences prérempies) en une transaction", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await emp());
    const jours = Array.from({ length: 7 }, (_, i) => `2026-12-${String(7 + i).padStart(2, "0")}`);
    for (const id of ids) for (const j of jours) await prisma.planningCreneau.create({ data: { employeeId: id, date: d(j), shiftId: matin } });
    for (const id of ids.slice(0, 15)) for (const j of jours) await presence(id, j, 8);
    const t0 = Date.now();
    await ecrire(ids.flatMap((id) => jours.map((j) => ({ employeeId: id, date: d(j), shiftId: soir }))), { genereAuto: true });
    const ms = Date.now() - t0;
    console.log("PERF 140 cellules / 105 recalages :", ms, "ms");
    expect(await heures(ids[0], jours[0])).toBe(6);
    expect(ms).toBeLessThan(20_000);
  });
});
