import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Jour M justifié (décision Direction 2026-10-12) : posé en lot sur les seuls jours M, tracé au
// journal, et perdu quand le jour quitte le code M.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, userId: "" }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: H.userId, role: "MANAGER", nom: "RH" }), requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { marquerMaladieJustifiee, joindreCertificatMaladie } = await import("./maladie-actions");
const { saisirPresence } = await import("./actions");

let prisma: PrismaClient; let fermer: () => Promise<void>; let emp = "";
const d = (j: number) => new Date(Date.UTC(2026, 9, j));
const iso = (j: number) => d(j).toISOString().slice(0, 10);

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  // Mois RH courant = octobre 2026, le mois des jours saisis ici. Sans Config, le verrou « mois passé »
  // (lib/presences-mois-serveur) lirait l'horloge : dès le 1er novembre 2026, tout ce fichier passerait
  // au rouge (octobre devenu « passé »), sans rapport avec la maladie justifiée.
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  H.userId = (await prisma.user.create({ data: { email: "rh@pef.cd", nom: "RH", role: "MANAGER" } })).id;
  emp = (await prisma.employee.create({ data: { matricule: "MJ1", nom: "Mado", sexe: "F", etatCivil: "C", poste: "P", secteur: "S", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-06"), contrat: "CDI", heuresParJour: 8 } })).id;
  for (const [j, code] of [[6, "M"], [7, "M"], [8, "P"]] as const) await prisma.attendance.create({ data: { employeeId: emp, date: d(j), code } });
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("marquerMaladieJustifiee", () => {
  it("en lot : seuls les jours M passent justifiés, les autres sont ignorés et le compte rendu le dit", async () => {
    const r = await marquerMaladieJustifiee([6, 7, 8].map((j) => ({ employeeId: emp, date: iso(j) })), true);
    expect(r.message).toBe("2 jour(s) de maladie justifié(s) — payé(s) 100 % ; 1 case(s) ignorée(s) (pas de code M).");
    const a = await prisma.attendance.findMany({ where: { employeeId: emp }, orderBy: { date: "asc" } });
    expect(a.map((x) => x.maladieJustifiee)).toEqual([true, true, false]);
    expect(await prisma.journalAudit.count({ where: { entite: "Attendance", champ: "maladieJustifiee" } })).toBe(2);
  });
  it("un jour qui quitte le code M perd son « justifié »", async () => {
    await saisirPresence(emp, iso(7), "A");
    const a = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp, date: d(7) } } });
    expect([a?.code, a?.maladieJustifiee]).toEqual(["A", false]);
  });
  it("un jour M justifié recouvert par un congé approuvé perd son « justifié » (pas de justificatif fantôme s'il redevient M)", async () => {
    const { poserCodesConge } = await import("@/lib/conges-presences");
    await marquerMaladieJustifiee([{ employeeId: emp, date: iso(6) }], true);
    await poserCodesConge(emp, d(6), d(6), "Congé annuel");
    const apres = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp, date: d(6) } } });
    expect([apres?.code, apres?.maladieJustifiee]).toEqual(["C", false]);
    await saisirPresence(emp, iso(6), "M");
    const retour = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp, date: d(6) } } });
    expect([retour?.code, retour?.maladieJustifiee]).toEqual(["M", false]);
  });

  // Bulletin du mois VALIDÉ : on ne justifie (ni ne déjustifie) un jour, on ne joint pas de certificat
  // sans rouvrir d'abord (Sacha, 2026-10-12) — rien n'est écrit.
  it("bulletin d'octobre validé : justifier, déjustifier ou joindre un certificat est refusé", async () => {
    await prisma.attendance.update({ where: { employeeId_date: { employeeId: emp, date: d(9) } }, data: { code: "M", maladieJustifiee: false } }).catch(async () =>
      prisma.attendance.create({ data: { employeeId: emp, date: d(9), code: "M" } }));
    const run = await prisma.payrollRun.create({ data: { mois: 10, annee: 2026, tauxChangeUtilise: 2800 } });
    await prisma.payrollLine.create({ data: { payrollRunId: run.id, employeeId: emp, statutPaiement: "VALIDE", salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 275, salNetCDF: 770000, cnssPatronalUSD: 39, coutEmployeurUSD: 340, coutEmployeurCDF: 952000 } });
    const r = await marquerMaladieJustifiee([{ employeeId: emp, date: iso(9) }], true);
    expect(r.erreur).toMatch(/^Le bulletin d.* 2026 est déjà validé : rouvrez-le/);
    expect((await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp, date: d(9) } } }))!.maladieJustifiee).toBe(false);
    const fd = new FormData();
    fd.set("employeeId", emp); fd.set("date", iso(9)); fd.set("fichier", new File(["%PDF"], "certificat.pdf", { type: "application/pdf" }));
    expect((await joindreCertificatMaladie(fd)).erreur).toMatch(/déjà validé : rouvrez-le/);
    expect(await prisma.documentEmploye.count({ where: { employeeId: emp } })).toBe(0);
  });
});
