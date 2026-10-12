import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";

// Audit paie du 2026-10-10 (#16) : quitter par Paramètres un mois NON clôturé dont la paie est
// calculée laissait ses bulletins non validés orphelins (plus recalculés ni validables depuis /paie).
// Désormais refusé comme pour un mois clôturé ; sans paie calculée, ou tout validé, le changement passe.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", role: "ADMIN", nom: "Direction", email: "d@pef.cd", accesStock: false, employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user, requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { calculerPaieDuMois, changerStatutPaie } = await import("@/app/(app)/paie/actions");
const { mettreAJourConfig } = await import("@/app/(app)/parametres/actions");

let prisma: PrismaClient; let fermer: () => Promise<void>; let empId = "";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const issue = async (p: Promise<unknown>) => {
  try { await p; } catch (e) {
    const m = String((e as Error).message);
    if (!m.startsWith("REDIRECT ")) throw e;
    return decodeURIComponent(m.slice("REDIRECT ".length));
  }
  return "";
};
const moisRH = async () => { const c = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } }); return `${c.moisCourant}/${c.anneeCourante}`; };
const changerMois = (mois: number) => issue(mettreAJourConfig(fd({ tauxChangeCDF: "2300", moisCourant: String(mois), anneeCourante: "2026", jourPaie: "30" })));

beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  empId = (await prisma.employee.create({ data: {
    matricule: "BO1", nom: "Bea Bureau", sexe: "F", etatCivil: "C", poste: "Compta", secteur: "Bureau", categorie: "BACKOFFICE",
    salaireMensuel: 400, heuresHebdomadaires: 45, heuresParJour: 9, dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI" } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("quitter un mois non clôturé", () => {
  it("sans paie calculée : le changement passe (aller-retour)", async () => {
    expect(await changerMois(10)).toBe("");
    expect(await changerMois(9)).toBe("");
    expect(await moisRH()).toBe("9/2026");
  });

  it("paie calculée, bulletin non validé : refusé, le mois ne bouge pas", async () => {
    await calculerPaieDuMois();
    expect(await changerMois(10)).toBe("/parametres?erreur=La paie du mois en cours n'est pas clôturée et 1 bulletin(s) ne sont pas validés (Bea Bureau) : validez-les et clôturez la paie, ou réinitialisez-la s'il ne s'agit que de brouillons, avant de changer de mois.");
    expect(await moisRH()).toBe("9/2026");
  });

  it("tous les bulletins validés (paie pas encore clôturée) : le changement passe", async () => {
    const l = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: empId } });
    await issue(changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) })));
    expect((await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: empId } })).statutPaiement).toBe("VALIDE");
    expect(await changerMois(10)).toBe("");
    expect(await moisRH()).toBe("10/2026");
  });
});
