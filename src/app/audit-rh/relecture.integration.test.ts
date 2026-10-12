// Non-régression de l'audit RH de terrain du 2026-10-10 (preuves « Sarasa », reprises et
// retournées : chaque test échouait sur le code d'avant le correctif).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  verifySession: async () => A.user,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé"); },
  invaliderProfil: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/contrats-notification", () => ({ notifierContratASigner: async () => {}, notifierSiContratARevoir: async () => {} }));

const PRES = await import("@/app/(app)/presences/actions");
const HEURES = await import("@/app/(app)/heures-supp/actions");
const CONGES = await import("@/app/(app)/conges/actions");
const PARAM = await import("@/app/(app)/parametres/actions");
const RH = await import("@/app/(app)/employes/actions");
const { chargerSoldeCongeSalarie } = await import("@/lib/solde-conge-salarie");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let n = 0;
async function emp() {
  n++;
  return (await prisma.employee.create({
    data: {
      matricule: `RV${n}-PEF`, nom: `Revue ${n}`, sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2020-01-06"), contrat: "CDI", heuresParJour: 8, heuresHebdomadaires: 48,
    },
  })).id;
}
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function url(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { const u = (e as { url?: string }).url; if (u !== undefined) return decodeURIComponent(u); throw e; }
}
const comme = (role: string) => { A.user = { ...A.user, role }; };
const jourPur = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Mois RH courant du scénario : depuis le 2026-10-12, un jour d'un mois ANTÉRIEUR au mois RH courant est en
 *  lecture seule (lib/presences-mois-serveur.ts). Une saisie se fait donc sur le mois en cours de son scénario. */
const moisRH = (mois: number) => prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: mois, anneeCourante: 2026 } });

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const u = await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } });
  A.user = { ...A.user, id: u.id, email: u.email, nom: u.nom };
  await prisma.typeConge.createMany({
    data: [
      { nom: "Congé annuel", tauxPct: 100, compteDansSolde: true, ordre: 1, systeme: true },
      { nom: "Congé sans solde", tauxPct: 0, ordre: 2 },
      { nom: "Congé maladie", ordre: 3, systeme: true },
    ],
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("relecture 2026-10-12 — bornes d'heures de la saisie directe", () => {
  beforeEach(() => moisRH(5));
  afterEach(() => moisRH(10));
  it("saisirHeures : négatif ou > 24 h refusé, rien d'écrit ; 0 vide toujours la case", async () => {
    comme("MANAGER");
    const id = await emp();
    for (const v of ["-3", "99", "24,5"]) await expect(HEURES.saisirHeures(id, "2026-05-04", v)).rejects.toThrow(/impossibles : une journée compte entre 0 et 24 heures/);
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
    await HEURES.saisirHeures(id, "2026-05-04", "7,5");
    expect(Number((await prisma.overtimeEntry.findFirstOrThrow({ where: { employeeId: id } })).heuresTravaillees)).toBe(7.5);
    await HEURES.saisirHeures(id, "2026-05-04", "0");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
  });
  it("saisirHeuresEnLot : une valeur hors bornes refuse tout le lot avant la première écriture", async () => {
    const id = await emp();
    await expect(HEURES.saisirHeuresEnLot([{ employeeId: id, date: "2026-05-04", heures: "8" }, { employeeId: id, date: "2026-05-05", heures: "250" }])).rejects.toThrow(/impossibles : une journée compte entre 0 et 24 heures/);
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
  });
});

describe("relecture — droits : un MANAGER qui envoie salaire/embauche/contrat/frais médicaux crée une demande, n'écrit jamais", () => {
  const base = (o: Record<string, string>) => ({
    sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE",
    transportJourCDF: "0", transportMoisCDF: "0", transportMoisUSD: "0", cnssMontant: "0", enfants: "0", heuresParJour: "8", heuresHebdomadaires: "48", type: "NATIONAL", ...o,
  });
  it("appel direct avec chacun des 4 champs : une demande « À valider » chacun, fiche inchangée ; sans eux : enregistré", async () => {
    // Décision de Sacha (2026-10-12) : la RH saisit, la Direction valide — jamais d'écriture directe.
    comme("MANAGER");
    const id = await emp();
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    for (const extra of [{ salaireMensuel: "9999" }, { dateEmbauche: "2001-01-01" }, { contrat: "CDD" }, { fraisMedicauxMoisCourant: "500" }] as Record<string, string>[]) {
      const r = await url(RH.modifierEmploye(id, fd(base({ matricule: e.matricule, nom: e.nom, ...extra }))));
      expect(r, JSON.stringify(extra)).toBe(`/employes/${id}`);
    }
    const apres = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect(Number(apres.salaireMensuel)).toBe(300);
    expect(apres.contrat).toBe("CDI");
    expect(jourPurIso(apres.dateEmbauche)).toBe("2020-01-06");
    expect(await prisma.demandeModifFiche.count({ where: { employeeId: id, statut: "EN_ATTENTE" } })).toBe(4);
    const ok = await url(RH.modifierEmploye(id, fd(base({ matricule: e.matricule, nom: e.nom, poste: "Chef" }))));
    expect(ok ?? "").not.toContain("erreur");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).poste).toBe("Chef");
    comme("ADMIN");
  });
});
const jourPurIso = (d: Date) => d.toISOString().slice(0, 10);

describe("relecture — retrait des heures sur un jour sans travail", () => {
  beforeEach(() => moisRH(5));
  afterEach(() => moisRH(10));
  it("heures SAISIES (7 h ≠ 8 h pré-rempli) : confirmation exigée, rien d'écrit avant", async () => {
    comme("MANAGER");
    const id = await emp();
    await prisma.attendance.create({ data: { employeeId: id, date: jourPur("2026-05-04"), code: "P" } });
    await prisma.overtimeEntry.create({ data: { employeeId: id, date: jourPur("2026-05-04"), heuresTravaillees: 7 } });
    const r = await PRES.saisirPresence(id, "2026-05-04", "M");
    expect(r.aConfirmer).toBeTruthy();
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: id } })).code).toBe("P");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(1);
    const r2 = await PRES.saisirPresence(id, "2026-05-04", "M", { confirmerRetraitHeures: true });
    expect(r2.info).toBeTruthy();
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
  });
  it("lot : une seule case à heures saisies suffit à tout suspendre (rien n'est écrit)", async () => {
    const a = await emp(); const b = await emp();
    await prisma.overtimeEntry.create({ data: { employeeId: b, date: jourPur("2026-05-05"), heuresTravaillees: 6 } });
    const r = await PRES.saisirPresencesEnLot([{ employeeId: a, date: "2026-05-05", code: "N" }, { employeeId: b, date: "2026-05-05", code: "N" }]);
    expect(r.aConfirmer).toBeTruthy();
    expect(await prisma.attendance.count({ where: { employeeId: { in: [a, b] } } })).toBe(0);
  });
  it("CARACTÉRISATION : heures = pré-rempli (8 h), sans pointage QR, code M posé : retirées SANS confirmation (dites)", async () => {
    const id = await emp();
    await prisma.attendance.create({ data: { employeeId: id, date: jourPur("2026-05-06"), code: "P" } });
    await prisma.overtimeEntry.create({ data: { employeeId: id, date: jourPur("2026-05-06"), heuresTravaillees: 8 } });
    const r = await PRES.saisirPresence(id, "2026-05-06", "O");
    expect(r.aConfirmer).toBeUndefined();
    expect(r.info).toContain("pré-remplie");
  });
});

describe("relecture — mois figé", () => {
  it("congé approuvé puis supprimé dans un mois figé : les C restent et ne sont comptés qu'UNE fois", async () => {
    comme("ADMIN");
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé annuel", dateDebut: "2026-03-09", dateFin: "2026-03-11", nbJours: "3" })));
    const q = new Date("2026-10-12T12:00:00Z");
    const avant = await chargerSoldeCongeSalarie(prisma, id, q);
    expect(avant.pris).toBe(3);
    await prisma.payrollRun.create({ data: { mois: 3, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    const dem = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: id } });
    await CONGES.supprimerCongesEnLot([dem.id]);
    expect(await prisma.attendance.count({ where: { employeeId: id, code: "C" } })).toBe(3);
    const apres = await chargerSoldeCongeSalarie(prisma, id, q);
    expect(apres.pris).toBe(3);
    expect(apres.cSansDemande).toBe(3);
    expect(apres.solde).toBe(avant.solde);
  });
  it("C sur dimanche/férié jamais décompté ; C de l'an dernier ignoré", async () => {
    const id = await emp();
    await prisma.jourFerie.create({ data: { date: jourPur("2026-06-30"), designation: "Indépendance", annee: 2026 } });
    for (const d of ["2026-06-28", "2026-06-30", "2025-06-02"]) await prisma.attendance.create({ data: { employeeId: id, date: jourPur(d), code: "C" } });
    expect((await chargerSoldeCongeSalarie(prisma, id, new Date("2026-10-12T12:00:00Z"))).cSansDemande).toBe(0);
  });
});

describe("relecture — férié retiré sur un jour déjà travaillé", () => {
  it("le retrait d'un férié ne remplace pas un P travaillé (9 h) par un C : heures conservées", async () => {
    comme("ADMIN");
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé annuel", dateDebut: "2027-05-03", dateFin: "2027-05-07", nbJours: "5" })));
    await prisma.attendance.update({ where: { employeeId_date: { employeeId: id, date: jourPur("2027-05-05") } }, data: { code: "P" } });
    await prisma.overtimeEntry.create({ data: { employeeId: id, date: jourPur("2027-05-05"), heuresTravaillees: 9 } });
    const f = await prisma.jourFerie.create({ data: { date: jourPur("2027-05-05"), designation: "X", annee: 2027 } });
    await PARAM.supprimerJourFerie(f.id).catch(() => {});
    const code = (await prisma.attendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: id, date: jourPur("2027-05-05") } } })).code;
    const h = await prisma.overtimeEntry.count({ where: { employeeId: id, date: jourPur("2027-05-05") } });
    expect({ code, h }).toEqual({ code: "P", h: 1 }); // jour travaillé : jamais écrasé par un C
  });
});
