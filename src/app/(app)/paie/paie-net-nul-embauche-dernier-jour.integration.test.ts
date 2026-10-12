import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jetonDe } from "@/lib/test/paie-jeton";

// Audit paie du 2026-10-10 (preuves Nagi) :
//  #1 embauché APRÈS la fin du mois : bulletin du mois entier (back-office) ou allocations pour 0 h
//     (brigade) → plus aucun bulletin ce mois-là. Absences N/S/M et entrée en cours de mois du
//     back-office : AUCUN montant changé (décision Direction en attente), mais un signalement nommé.
//  #5 net négatif possible sans alerte → signalé, et la validation (unitaire comme la clôture) refusée ;
//     l'échéance de prêt du mois est réservée sur le plafond d'acompte.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "d@pef.cd", nom: "Direction", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("refus"); },
  requireModule: () => {}, invaliderProfil: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { calculerPaieDuMois, changerStatutPaie } = await import("./actions");


// Relecture indépendante (2026-10-10) : deux cas limites que le lot annonce sans les couvrir.
//  - embauché le DERNIER jour du mois : payé (la règle exclut > dernier jour, pas >=) ;
//  - net NUL légitime (congé sans solde tout le mois, aucune retenue) : reste validable, sinon la
//    clôture serait bloquée sans remède.
let prisma: PrismaClient; let fermer: () => Promise<void>;
const ids: Record<string, string> = {};
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ligne = (employeeId: string) => prisma.payrollLine.findFirst({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
async function erreurDe(action: Promise<unknown>): Promise<string | null> {
  try { await action; return null; } catch (e) {
    const m = String((e as Error).message).match(/erreur=([^&]*)/);
    if (m) return decodeURIComponent(m[1]);
    throw e;
  }
}
beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const cree = (matricule: string, nom: string, categorie: "BACKOFFICE" | "BRIGADE", embauche: string, enfants = 0) =>
    prisma.employee.create({ data: {
      matricule, nom, sexe: "F", etatCivil: "C", poste: "Poste", secteur: "Secteur", categorie,
      salaireMensuel: 400, heuresHebdomadaires: 45, heuresParJour: 9, enfants, dateEmbauche: new Date(`${embauche}T00:00:00Z`), contrat: "CDI" } });
  ids.dernierJour = (await cree("BO1", "Dernier Jour", "BACKOFFICE", "2026-09-30")).id;
  ids.lendemain = (await cree("BO2", "Lendemain", "BACKOFFICE", "2026-10-01")).id;
  ids.sansSolde = (await cree("BR1", "Sans Solde", "BRIGADE", "2025-01-06")).id;
  ids.sansSoldeEnfants = (await cree("BR2", "Sans Solde Enfants", "BRIGADE", "2025-01-06", 4)).id;
  for (const id of [ids.sansSolde, ids.sansSoldeEnfants]) {
    for (let j = 1; j <= 30; j++) await prisma.attendance.create({ data: { employeeId: id, date: new Date(Date.UTC(2026, 8, j)), code: "S" } });
  }
  await calculerPaieDuMois();
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("embauche le dernier jour du mois", () => {
  it("embauché le 30/09 : bulletin de septembre ; embauché le 01/10 : aucun", async () => {
    expect(await ligne(ids.dernierJour)).not.toBeNull();
    expect(await ligne(ids.lendemain)).toBeNull();
  });
});

describe("net nul légitime : sans solde tout le mois, aucune retenue", () => {
  for (const [nom, cle] of [["sans enfant", "sansSolde"], ["avec enfants", "sansSoldeEnfants"]] as const) {
    it(`${nom} : le net n'est pas négatif et la ligne se valide`, async () => {
      const l = (await ligne(ids[cle]))!;
      expect(l).not.toBeNull();
      expect(Number(l.salNetUSD)).toBeGreaterThanOrEqual(0);
      expect(Number(l.acompteUSD) + Number(l.retenuePretUSD)).toBe(0);
      expect(await erreurDe(changerStatutPaie(l.id, fd({ versStatut: "VALIDE", jeton: await jetonDe(prisma, l.id) })))).toBeNull();
      expect((await ligne(ids[cle]))!.statutPaiement).toBe("VALIDE");
    });
  }
});
