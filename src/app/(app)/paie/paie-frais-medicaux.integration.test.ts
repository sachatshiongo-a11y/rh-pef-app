import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Test d'INTÉGRATION — #1 (CRITIQUE, régression) : le solde « frais médicaux du mois » saisi sur
// la fiche employé (Employee.fraisMedicauxMoisCourant) ne doit JAMAIS disparaître silencieusement
// avant que le bulletin ne soit réellement validé. Avant le correctif du 2026-07-22, il était remis
// à zéro dès le premier rafraîchissement (même silencieux, à la simple ouverture de /paie) — perte
// d'argent silencieuse et non tracée. Il doit maintenant survivre à N rafraîchissements de brouillon
// et n'être remis à zéro qu'UNE SEULE FOIS, au moment de la transition PAS_VALIDE → VALIDE.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { calculerPaieDuMois, changerStatutPaie } = await import("./actions");
const { rafraichirPaieDuMois } = await import("@/lib/paie-refresh");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const employe = () => prisma.employee.findUniqueOrThrow({ where: { id: empId } });
// Une seule PayrollRun existe dans ce test (mois 7/2026) — au plus une ligne par employé
// (contrainte d'unicité [payrollRunId, employeeId]), recréée à chaque rafraîchissement tant
// qu'elle n'est pas figée.
const ligneDuMois = () => prisma.payrollLine.findFirstOrThrow({ where: { employeeId: empId } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  const u = await prisma.user.create({ data: { email: "admin@pef.cd", nom: "Admin Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 7 } });

  const e = await prisma.employee.create({
    data: {
      matricule: "FM01-PEF", nom: "Frais Médicaux Test", sexe: "F", etatCivil: "Célibataire",
      poste: "Comptable", secteur: "Administration", categorie: "BACKOFFICE",
      salaireMensuel: 200, dateEmbauche: new Date("2024-01-01"), contrat: "CDI",
      fraisMedicauxMoisCourant: 25, // saisie manuelle du mois, AVANT tout calcul de paie
    },
  });
  empId = e.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("#1 — frais médicaux jamais perdus au rafraîchissement d'un brouillon", () => {
  it("calculerPaieDuMois (bouton « Calculer ») : le solde de la fiche employé reste inchangé et apparaît sur la ligne", async () => {
    await calculerPaieDuMois();
    const emp = await employe();
    expect(Number(emp.fraisMedicauxMoisCourant)).toBe(25); // inchangé
    const ligne = await ligneDuMois();
    expect(Number(ligne.fraisMedicauxUSD)).toBe(25); // capté sur la ligne du brouillon
    expect(ligne.statutPaiement).toBe("PAS_VALIDE");
  });

  it("rafraîchissement SILENCIEUX répété (creerRun:false, comme à chaque ouverture de /paie) : toujours inchangé", async () => {
    await rafraichirPaieDuMois({ creerRun: false });
    await rafraichirPaieDuMois({ creerRun: false });
    await rafraichirPaieDuMois({ creerRun: false });
    const emp = await employe();
    expect(Number(emp.fraisMedicauxMoisCourant)).toBe(25);
    const ligne = await ligneDuMois();
    expect(Number(ligne.fraisMedicauxUSD)).toBe(25);
  });

  it("validation du bulletin (PAS_VALIDE → VALIDE) : remis à zéro UNE SEULE FOIS, montant conservé sur la ligne figée", async () => {
    const avant = await ligneDuMois();
    await changerStatutPaie(avant.id, fd({ versStatut: "VALIDE" }));

    const emp = await employe();
    expect(Number(emp.fraisMedicauxMoisCourant)).toBe(0); // remis à zéro à la validation, pas avant

    const ligne = await ligneDuMois();
    expect(ligne.statutPaiement).toBe("VALIDE");
    expect(Number(ligne.fraisMedicauxUSD)).toBe(25); // le bulletin figé garde le montant capté
  });

  it("aucun double comptage : un rafraîchissement après validation ne réapplique pas 25 $ une 2e fois (ligne figée, plus rien à saisir)", async () => {
    // La ligne est VALIDE (figée) : rafraichirPaieDuMois ne la recalcule jamais.
    await rafraichirPaieDuMois({ creerRun: false });
    const emp = await employe();
    expect(Number(emp.fraisMedicauxMoisCourant)).toBe(0);
    const ligne = await ligneDuMois();
    expect(Number(ligne.fraisMedicauxUSD)).toBe(25); // toujours le montant figé, jamais réappliqué en plus
  });
});
