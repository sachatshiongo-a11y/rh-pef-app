import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Audit paie du 2026-10-10 (#4) : le solde de tout compte ignorait le reste du prêt et les acomptes
// non retenus, n'était pas transactionnel, pouvait être établi deux fois, et ne signalait pas un
// bulletin du mois déjà validé (double paiement). CNSS/IPR : NON traités (avertissement seulement).
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

const { terminerContrat } = await import("./dossier-actions");
const { chargerReprisesSolde } = await import("@/lib/solde-tout-compte");
const { calculerPaieDuMois } = await import("@/app/(app)/paie/actions");

let prisma: PrismaClient; let fermer: () => Promise<void>;
const ids = { bea: "", dora: "", eli: "" };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const solde = (extra: Record<string, string> = {}) => fd({ motif: "DEMISSION", dateFin: "2026-09-20", joursTravaillesMois: "13", joursCongesNonPris: "0", preavisJours: "0", indemniteLicenciementUSD: "0", autresUSD: "0", ...extra });
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
  const cree = (matricule: string, nom: string) => prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "C", poste: "Compta", secteur: "Bureau", categorie: "BACKOFFICE",
    salaireMensuel: 520, heuresHebdomadaires: 45, heuresParJour: 9, dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI" } });
  ids.bea = (await cree("BO1", "Bea Bureau")).id;
  ids.dora = (await cree("BO2", "Dora Dette")).id;
  ids.eli = (await cree("BO3", "Eli Valide")).id;
  // Bea : prêt de 300 $ dont 100 $ déjà retenus en août → reste 200 $ ; acompte de 50 $ approuvé en septembre.
  const pret = await prisma.pretPersonnel.create({ data: { employeeId: ids.bea, montantUSD: 300, retenueMensuelleUSD: 100 } });
  await prisma.retenuePret.create({ data: { pretId: pret.id, mois: 8, annee: 2026, montantUSD: 100 } });
  await prisma.acompteSalaire.create({ data: { employeeId: ids.bea, montantUSD: 50, mois: 9, annee: 2026, statut: "APPROUVE" } });
  // Dora : prêt de 5 000 $ — plus que tout solde possible.
  await prisma.pretPersonnel.create({ data: { employeeId: ids.dora, montantUSD: 5000, retenueMensuelleUSD: 100 } });
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("solde de tout compte : reprises, transaction unique, un seul solde", () => {
  it("écart entre l'écran et la base : refus, rien d'écrit", async () => {
    expect(await erreurDe(terminerContrat(ids.bea, solde({ reprisePretUSD: "100.00", repriseAcomptesUSD: "50.00" })))).toBe(
      "Le reste des prêts ou les acomptes à reprendre ont changé depuis l'affichage : rechargez la fiche et relisez le solde. Rien n'a été enregistré.");
    expect(await prisma.finContrat.count()).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.bea } })).actif).toBe(true);
  });

  it("le solde reprend le reste du prêt (200 $) et l'acompte non retenu (50 $) ; prêt soldé, contrats résiliés, fiche désactivée", async () => {
    expect(await erreurDe(terminerContrat(ids.bea, solde({ reprisePretUSD: "200.00", repriseAcomptesUSD: "50.00" })))).toBeNull();
    const f = await prisma.finContrat.findFirstOrThrow({ where: { employeeId: ids.bea } });
    expect(Number(f.totalUSD)).toBe(260); // 520 / 26 j × 13 j
    expect(Number(f.reprisePretUSD)).toBe(200);
    expect(Number(f.repriseAcomptesUSD)).toBe(50); // net versé : 10 $ (et non 260 $)
    expect((await prisma.pretPersonnel.findFirstOrThrow({ where: { employeeId: ids.bea } })).statut).toBe("SOLDE");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.bea } })).actif).toBe(false);
    const j = await prisma.journalAudit.findFirstOrThrow({ where: { entite: "Employee", entiteId: ids.bea, champ: "finContrat" } });
    expect(j.nouvelleValeur).toBe("DEMISSION — solde 260.00 $ (prêt repris 200,00 $, acomptes repris 50,00 $ ; net à verser 10.00 $)");
  });

  it("second solde (double clic, second onglet) : refusé, un seul solde archivé", async () => {
    expect(await erreurDe(terminerContrat(ids.bea, solde()))).toBe("Bea Bureau n'est plus actif : son contrat est déjà terminé. Un seul solde de tout compte par départ — rien n'a été enregistré.");
    // Fiche réactivée par erreur sans nouvelle embauche : la fin déjà enregistrée suffit à refuser.
    await prisma.employee.update({ where: { id: ids.bea }, data: { actif: true } });
    expect(await erreurDe(terminerContrat(ids.bea, solde()))).toMatch(/^Une fin de contrat au 20\/09\/2026 est déjà enregistrée pour Bea Bureau/);
    expect(await prisma.finContrat.count({ where: { employeeId: ids.bea } })).toBe(1);
  });

  it("reprises supérieures au solde : refus (la Direction décide), rien d'écrit — ni fiche désactivée, ni prêt soldé", async () => {
    const err = await erreurDe(terminerContrat(ids.dora, solde()));
    expect(err).toContain("resteraient dus par Dora Dette");
    expect(await prisma.finContrat.count({ where: { employeeId: ids.dora } })).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.dora } })).actif).toBe(true);
    expect((await prisma.pretPersonnel.findFirstOrThrow({ where: { employeeId: ids.dora } })).statut).toBe("EN_COURS");
  });

  it("bulletin du mois déjà validé : signalé (double paiement) ; un acompte approuvé après la validation reste à reprendre", async () => {
    await calculerPaieDuMois();
    await prisma.payrollLine.updateMany({ where: { employeeId: ids.eli }, data: { statutPaiement: "VALIDE" } });
    await prisma.acompteSalaire.create({ data: { employeeId: ids.eli, montantUSD: 30, mois: 9, annee: 2026, statut: "APPROUVE" } });
    const r = await chargerReprisesSolde(prisma, ids.eli, { mois: 9, annee: 2026 });
    expect(r.bulletinFigeDuMois).toEqual({ mois: 9, annee: 2026, statut: "VALIDE" });
    expect(r.acomptes).toEqual([{ mois: 9, annee: 2026, montantUSD: 30 }]);
    expect(r.reprisePretUSD).toBe(0);
  });
});
