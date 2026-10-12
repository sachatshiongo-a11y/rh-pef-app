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

const { marquerMaladieJustifiee } = await import("./maladie-actions");
const { saisirPresence } = await import("./actions");

let prisma: PrismaClient; let fermer: () => Promise<void>; let emp = "";
const d = (j: number) => new Date(Date.UTC(2026, 9, j));
const iso = (j: number) => d(j).toISOString().slice(0, 10);

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
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
});
