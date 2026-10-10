// Non-régression de l'audit RH de terrain du 2026-10-10 (preuves « Sarasa », reprises et
// retournées : chaque test échouait sur le code d'avant le correctif).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
const IMPORT = await import("@/app/(app)/presences/import-actions");
const CONGES = await import("@/app/(app)/conges/actions");
const PARAM = await import("@/app/(app)/parametres/actions");
const TYPES = await import("@/app/(app)/parametres/typeconge-actions");
const RH = await import("@/app/(app)/employes/actions");
const ESPACE = await import("@/app/espace/actions");
const POINTAGE = await import("@/app/pointage/actions");
const { chargerSoldeCongeSalarie } = await import("@/lib/solde-conge-salarie");
const { inactifsDeLaPeriode } = await import("@/lib/salaries-sortis");
const { hsValoriseesPaie } = await import("@/lib/hs-valorisees-paie");
const { calculerBulletinLive } = await import("@/lib/bulletin-live");
const { chargerParametresPaie } = await import("@/lib/config");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let adminId = "";
let n = 0;
async function emp(o: { dateEmbauche?: string; actif?: boolean; categorie?: "BRIGADE" | "BACKOFFICE" } = {}) {
  n++;
  return (await prisma.employee.create({
    data: {
      matricule: `TS${n}-PEF`, nom: `Salarié ${n}`, sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine",
      categorie: o.categorie ?? "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date(o.dateEmbauche ?? "2020-01-06"), contrat: "CDI",
      heuresParJour: 8, heuresHebdomadaires: 48, actif: o.actif ?? true,
    },
  })).id;
}
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
/** Exécute une action de formulaire : renvoie l'URL de redirection (succès ou `?erreur=`), ou null. */
async function url(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { const u = (e as { url?: string }).url; if (u !== undefined) return decodeURIComponent(u); throw e; }
}
const comme = (role: string, employeeId: string | null = null) => { A.user = { ...A.user, role, employeeId }; };
const jourPur = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const u = await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } });
  adminId = u.id;
  A.user = { ...A.user, id: u.id, email: u.email, nom: u.nom };
  await prisma.typeConge.createMany({
    data: [
      { nom: "Congé annuel", tauxPct: 100, compteDansSolde: true, ordre: 1, systeme: true },
      { nom: "Congé sans solde", tauxPct: 0, ordre: 2 },
      { nom: "Congé maladie", ordre: 3, systeme: true },
      { nom: "Mariage", ordre: 4 },
      { nom: "Type retiré", ordre: 5, actif: false },
    ],
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("1 — types de congé : un type utilisé ou protégé ne se renomme ni ne se supprime ; le type est vérifié", () => {
  it("renommer « Congé annuel » (protégé, utilisé) est refusé : le solde ne bouge pas", async () => {
    comme("ADMIN");
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé annuel", dateDebut: "2026-11-16", dateFin: "2026-11-18", nbJours: "3" })));
    const avant = await chargerSoldeCongeSalarie(prisma, id, new Date("2026-11-20T12:00:00Z"));
    const t = await prisma.typeConge.findUniqueOrThrow({ where: { nom: "Congé annuel" } });
    const r = await TYPES.modifierTypeConge(t.id, fd({ nom: "Congé annuel payé", tauxPct: "100", compteDansSolde: "on" }));
    expect(r).toMatchObject({ erreur: expect.stringContaining("protégé") });
    expect((await prisma.typeConge.findUniqueOrThrow({ where: { id: t.id } })).nom).toBe("Congé annuel");
    expect((await chargerSoldeCongeSalarie(prisma, id, new Date("2026-11-20T12:00:00Z"))).solde).toBe(avant.solde);
  });

  it("un type non protégé mais utilisé ne se renomme pas, ne se supprime pas ; il se désactive", async () => {
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Mariage", dateDebut: "2026-11-02", dateFin: "2026-11-02", nbJours: "1" })));
    const t = await prisma.typeConge.findUniqueOrThrow({ where: { nom: "Mariage" } });
    expect(await TYPES.modifierTypeConge(t.id, fd({ nom: "Mariage civil", tauxPct: "" }))).toMatchObject({ erreur: expect.stringContaining("1 demande") });
    expect(await TYPES.supprimerTypeConge(t.id)).toMatchObject({ erreur: expect.stringContaining("Désactivez-le") });
    expect(await prisma.typeConge.findUnique({ where: { id: t.id } })).not.toBeNull();
    expect(await TYPES.basculerTypeConge(t.id)).toBeUndefined();
    expect((await prisma.typeConge.findUniqueOrThrow({ where: { id: t.id } })).actif).toBe(false);
  });

  it("« Congé sans solde » ne se supprime pas et reste à 0 % (sinon ses jours seraient payés « C »)", async () => {
    const ss = await prisma.typeConge.findUniqueOrThrow({ where: { nom: "Congé sans solde" } });
    expect(await TYPES.supprimerTypeConge(ss.id)).toMatchObject({ erreur: expect.stringContaining("protégé") });
    expect(await TYPES.modifierTypeConge(ss.id, fd({ nom: "Congé sans solde", tauxPct: "100" }))).toMatchObject({ erreur: expect.stringContaining("0 %") });
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé sans solde", dateDebut: "2026-11-23", dateFin: "2026-11-23", nbJours: "1" })));
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: id } })).code).toBe("S");
  });

  it("un type inconnu ou désactivé est refusé à la création (Direction et espace salarié)", async () => {
    const id = await emp();
    expect(await url(CONGES.demanderConge(fd({ employeeId: id, type: "Texte libre", dateDebut: "2026-11-02", dateFin: "2026-11-02", nbJours: "1" })))).toContain("Type de congé inconnu");
    expect(await url(CONGES.demanderConge(fd({ employeeId: id, type: "Type retiré", dateDebut: "2026-11-02", dateFin: "2026-11-02", nbJours: "1" })))).toContain("désactivé");
    expect(await prisma.leaveRequest.count({ where: { employeeId: id } })).toBe(0);
  });

  it("un type inutilisé, non protégé, se renomme et se supprime toujours", async () => {
    const t = await prisma.typeConge.create({ data: { nom: "Brouillon", ordre: 9 } });
    expect(await TYPES.modifierTypeConge(t.id, fd({ nom: "Brouillon 2", tauxPct: "" }))).toBeUndefined();
    expect(await TYPES.supprimerTypeConge(t.id)).toBeUndefined();
  });
});

describe("2 — « C » posé dans la grille sans demande : décompté, sans double compte, et signalé", () => {
  it("3 C posés en lot entament le solde de 3 ; une demande approuvée qui en couvre 2 ne les recompte pas", async () => {
    comme("ADMIN");
    const id = await emp();
    const quand = new Date("2026-10-10T12:00:00Z");
    const avant = await chargerSoldeCongeSalarie(prisma, id, quand);
    await PRES.saisirPresencesEnLot(["2026-10-05", "2026-10-06", "2026-10-07"].map((date) => ({ employeeId: id, date, code: "C" as const })));
    const apres = await chargerSoldeCongeSalarie(prisma, id, quand);
    expect(apres.cSansDemande).toBe(3);
    expect(apres.solde).toBe(Math.round((avant.solde - 3) * 10) / 10);
    // Régularisation : la demande des 6-7 octobre est enregistrée (Direction, approuvée d'office).
    await prisma.leaveRequest.create({ data: { employeeId: id, type: "Congé annuel", dateDebut: jourPur("2026-10-06"), dateFin: jourPur("2026-10-07"), nbJours: 2, statut: "APPROUVE" } });
    const regularise = await chargerSoldeCongeSalarie(prisma, id, quand);
    expect(regularise.cSansDemande).toBe(1);
    expect(regularise.pris).toBe(3); // 2 (demande) + 1 (C sans demande) — jamais 5
  });
});

describe("3 — une demande qui recouvre une demande en attente ou approuvée est refusée", () => {
  it("Direction : le même congé saisi deux fois n'est enregistré qu'une fois (3 jours décomptés, pas 6)", async () => {
    comme("ADMIN");
    const id = await emp();
    const f = () => fd({ employeeId: id, type: "Congé annuel", dateDebut: "2026-11-02", dateFin: "2026-11-04", nbJours: "3" });
    await url(CONGES.demanderConge(f()));
    expect(await url(CONGES.demanderConge(f()))).toContain("recouvre ces dates");
    expect(await prisma.leaveRequest.count({ where: { employeeId: id } })).toBe(1);
    expect((await chargerSoldeCongeSalarie(prisma, id, new Date("2026-11-10T12:00:00Z"))).pris).toBe(3);
  });

  it("RH (en attente) puis chevauchement partiel : refusé", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé annuel", dateDebut: "2026-12-14", dateFin: "2026-12-16", nbJours: "3" })));
    expect(await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé maladie", dateDebut: "2026-12-16", dateFin: "2026-12-18", nbJours: "3" })))).toContain("en attente qui recouvre");
    comme("ADMIN");
  });

  it("espace salarié : une demande qui recouvre la sienne est refusée", async () => {
    const id = await emp();
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: true } });
    comme("EMPLOYE", id);
    const f = () => fd({ type: "Congé annuel", dateDebut: "2027-01-11", dateFin: "2027-01-12", nbJours: "2" });
    expect(await url(ESPACE.demanderMonConge(f()))).toContain("envoye=1");
    expect(await url(ESPACE.demanderMonConge(f()))).toContain("Vous avez déjà une demande");
    expect(await prisma.leaveRequest.count({ where: { employeeId: id } })).toBe(1);
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: false } });
    comme("ADMIN");
  });

  it("approbation en lot de deux demandes en attente qui se recouvrent : une seule approuvée, l'autre nommée", async () => {
    const id = await emp();
    const a = await prisma.leaveRequest.create({ data: { employeeId: id, type: "Congé annuel", dateDebut: jourPur("2027-02-01"), dateFin: jourPur("2027-02-03"), nbJours: 3 } });
    const b = await prisma.leaveRequest.create({ data: { employeeId: id, type: "Congé annuel", dateDebut: jourPur("2027-02-02"), dateFin: jourPur("2027-02-04"), nbJours: 3 } });
    const r = await CONGES.approuverCongesEnLot([a.id, b.id]);
    expect(r.traitees).toBe(1);
    expect(r.echecs.join(" ")).toContain("recouvre ces dates");
    expect(await prisma.leaveRequest.count({ where: { employeeId: id, statut: "APPROUVE" } })).toBe(1);
  });
});

describe("4 — férié ajouté ou retiré après coup : les congés qui le couvrent sont recalés", () => {
  it("ajout : 6 → 5 jours et le C du férié retiré ; retrait : 5 → 6 et le C reposé ; doublon : message lisible", async () => {
    comme("ADMIN");
    const id = await emp();
    await url(CONGES.demanderConge(fd({ employeeId: id, type: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-12", nbJours: "6" })));
    const ok = await url(PARAM.ajouterJourFerie(fd({ date: "2026-12-09", designation: "Férié ajouté" })));
    expect(ok).toContain("msg=");
    expect(ok).toContain("1 demande(s) de congé recalculée(s)");
    const d = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: id } });
    expect(Number(d.nbJours)).toBe(5);
    expect(await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: id, date: jourPur("2026-12-09") } } })).toBeNull();

    expect(await url(PARAM.ajouterJourFerie(fd({ date: "2026-12-09", designation: "Encore" })))).toContain("erreur=Le 09/12/2026 est déjà un jour férié");

    const f = await prisma.jourFerie.findUniqueOrThrow({ where: { date: jourPur("2026-12-09") } });
    await url(PARAM.supprimerJourFerie(f.id));
    expect(Number((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: d.id } })).nbJours)).toBe(6);
    expect((await prisma.attendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: id, date: jourPur("2026-12-09") } } })).code).toBe("C");
  });
});

describe("5 — un jour qui passe à N, A, M ou O perd ses heures (confirmation si elles ont été saisies)", () => {
  it("P puis N : les 8 h pré-remplies sont retirées, et c'est dit", async () => {
    comme("MANAGER");
    const id = await emp();
    await PRES.saisirPresence(id, "2026-10-06", "P");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(1);
    const r = await PRES.saisirPresence(id, "2026-10-06", "N");
    expect(r.info).toContain("pré-remplie(s) retirée(s)");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: id } })).code).toBe("N");
  });

  it("heures saisies à la main (10 h) puis M : rien n'est écrit sans confirmation ; avec, elles partent", async () => {
    const id = await emp();
    await PRES.saisirPresence(id, "2026-10-07", "P");
    await prisma.overtimeEntry.update({ where: { employeeId_date: { employeeId: id, date: jourPur("2026-10-07") } }, data: { heuresTravaillees: 10 } });
    const q = await PRES.saisirPresence(id, "2026-10-07", "M");
    expect(q.aConfirmer).toContain("10 h");
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: id } })).code).toBe("P");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(1);
    const r = await PRES.saisirPresence(id, "2026-10-07", "M", { confirmerRetraitHeures: true });
    expect(r.info).toContain("après confirmation");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
    comme("ADMIN");
  });

  it("en lot : O sur des jours P pré-remplis retire les heures, le compte rendu le dit", async () => {
    const id = await emp();
    await PRES.saisirPresencesEnLot(["2026-10-12", "2026-10-13"].map((date) => ({ employeeId: id, date, code: "P" as const })));
    const r = await PRES.saisirPresencesEnLot(["2026-10-12", "2026-10-13"].map((date) => ({ employeeId: id, date, code: "O" as const })));
    expect(r.message).toContain("2 case(s) enregistrée(s)");
    expect(r.message).toContain("16 h pré-remplie(s) retirée(s)");
    expect(await prisma.overtimeEntry.count({ where: { employeeId: id } })).toBe(0);
  });
});

describe("6 — « Modifier » : salaire, embauche, contrat et frais médicaux réservés à la Direction", () => {
  const champs = (id: string, o: Record<string, string> = {}) => ({
    matricule: `TS${id}`, sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE",
    transportJourCDF: "0", transportMoisCDF: "0", transportMoisUSD: "0", cnssMontant: "0", enfants: "0", heuresParJour: "8", heuresHebdomadaires: "48", type: "NATIONAL", ...o,
  });
  it("un responsable (MANAGER) qui envoie le salaire est refusé ; sans ces champs, la fiche se modifie et le salaire ne bouge pas", async () => {
    const id = await emp();
    const { matricule: m, nom } = await prisma.employee.findUniqueOrThrow({ where: { id } });
    comme("MANAGER");
    const refus = await url(RH.modifierEmploye(id, fd(champs(id, { matricule: m, nom, salaireMensuel: "900", dateEmbauche: "2010-01-01", contrat: "CDI", fraisMedicauxMoisCourant: "0" }))));
    expect(refus).toContain("Direction seulement");
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(300);
    const ok = await url(RH.modifierEmploye(id, fd(champs(id, { matricule: m, nom, poste: "Chef de partie" }))));
    expect(ok).toBe("/employes");
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect(e.poste).toBe("Chef de partie");
    expect(Number(e.salaireMensuel)).toBe(300);
    expect(e.dateEmbauche.toISOString().slice(0, 10)).toBe("2020-01-06");
    comme("ADMIN");
  });

  it("Direction : un changement de salaire par « Modifier » laisse un historique et une trace", async () => {
    comme("ADMIN");
    const id = await emp();
    const { matricule: m, nom } = await prisma.employee.findUniqueOrThrow({ where: { id } });
    await url(RH.modifierEmploye(id, fd(champs(id, { matricule: m, nom, salaireMensuel: "350", dateEmbauche: "2020-01-06", contrat: "CDI", fraisMedicauxMoisCourant: "0" }))));
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(350);
    const h = await prisma.historiqueSalaire.findMany({ where: { employeeId: id } });
    expect(h.map((x) => [Number(x.ancienSalaire), Number(x.nouveauSalaire)])).toEqual([[300, 350]]);
    expect(await prisma.journalAudit.count({ where: { entiteId: id, champ: "salaireMensuel" } })).toBe(1);
  });
});

describe("7 — congé décidé sur un mois dont la paie est validée : la grille de ce mois n'est pas réécrite", () => {
  it("approbation en mars 2027 figé : aucun C posé, la décision le dit ; suppression : les codes du mois figé restent", async () => {
    comme("ADMIN");
    const id = await emp();
    const d = await prisma.leaveRequest.create({ data: { employeeId: id, type: "Congé annuel", dateDebut: jourPur("2027-03-01"), dateFin: jourPur("2027-03-02"), nbJours: 2 } });
    await prisma.attendance.create({ data: { employeeId: id, date: jourPur("2027-03-01"), code: "P" } });
    await prisma.payrollRun.create({ data: { mois: 3, annee: 2027, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    const r = await CONGES.approuverConge(d.id);
    expect(r.avertissement).toContain("paie est validée");
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: id } })).code).toBe("P");
    expect(await prisma.attendance.count({ where: { employeeId: id } })).toBe(1);
    // Un C du mois figé posé avant la validation reste à la suppression de la demande.
    await prisma.attendance.create({ data: { employeeId: id, date: jourPur("2027-03-02"), code: "C" } });
    const lot = await CONGES.supprimerCongesEnLot([d.id]);
    expect(lot.avertissements?.join(" ")).toContain("paie est validée");
    expect((await prisma.attendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: id, date: jourPur("2027-03-02") } } })).code).toBe("C");
  });
});

describe("9 — saisie en lot : tout ou rien, compte rendu exact", () => {
  it("un mois entier pour 3 salariés s'écrit d'un bloc ; une case invalide fait tout échouer, rien n'est écrit", async () => {
    comme("ADMIN");
    const ids = [await emp(), await emp(), await emp()];
    const jours = Array.from({ length: 30 }, (_, i) => `2026-04-${String(i + 1).padStart(2, "0")}`);
    const entrees = ids.flatMap((employeeId) => jours.map((date) => ({ employeeId, date, code: "N" as const })));
    const r = await PRES.saisirPresencesEnLot(entrees);
    expect(r.message).toBe("90 case(s) enregistrée(s).");
    expect(await prisma.attendance.count({ where: { employeeId: { in: ids } } })).toBe(90);

    const autres = [await emp(), await emp()];
    const lot = [...autres.flatMap((employeeId) => jours.map((date) => ({ employeeId, date, code: "P" as const }))), { employeeId: "fiche-inexistante", date: "2026-04-30", code: "P" as const }];
    await expect(PRES.saisirPresencesEnLot(lot)).rejects.toThrow();
    expect(await prisma.attendance.count({ where: { employeeId: { in: autres } } })).toBe(0);
    expect(await prisma.overtimeEntry.count({ where: { employeeId: { in: autres } } })).toBe(0);
  });
});

describe("10 — salarié sorti dans le mois : présent pour ses jours actifs, grille et IVMS", () => {
  it("visible dans le mois de sa sortie ; un jour après la sortie est ignoré, un jour avant s'écrit ; l'IVMS le signale", async () => {
    comme("ADMIN");
    const id = await emp({ actif: false });
    await prisma.finContrat.create({ data: { employeeId: id, motif: "DEMISSION", dateFin: jourPur("2026-08-12"), salaireJournalierUSD: 10 } });
    expect(await inactifsDeLaPeriode(prisma, jourPur("2026-08-01"), jourPur("2026-08-31"))).toContain(id);
    expect(await inactifsDeLaPeriode(prisma, jourPur("2026-09-01"), jourPur("2026-09-30"))).not.toContain(id);
    const r = await PRES.saisirPresencesEnLot([{ employeeId: id, date: "2026-08-11", code: "P" }, { employeeId: id, date: "2026-08-13", code: "P" }]);
    expect(r.ignores).toEqual([{ employeeId: id, date: "2026-08-13" }]);
    expect(r.message).toContain("1 après la sortie du salarié");
    expect(await prisma.attendance.count({ where: { employeeId: id } })).toBe(1);

    const m = (await prisma.employee.findUniqueOrThrow({ where: { id } })).matricule;
    const csv = `ID,Date/Heure\n${m},10/08/2026 08:00\n${m},10/08/2026 16:30\n${m},13/08/2026 08:00\n${m},13/08/2026 16:00\n`;
    const f = new FormData();
    f.set("fichier", new File([csv], "rapport.csv", { type: "text/csv" }));
    const a = await IMPORT.analyserPointageIVMS(null, f);
    expect(a.lignes.map((l) => [l.employeeId, l.date])).toEqual([[id, "2026-08-10"]]);
    expect(a.anomalies.find((x) => x.type === "APRES_SORTIE")?.date).toBe("2026-08-13");
  });
});

describe("8 — import IVMS : dates JJ/MM/AAAA lues explicitement, lignes illisibles signalées, existant montré", () => {
  it("05/10 = 5 octobre (pas le 10 mai), 13/10 n'est plus perdu, 31/02 est signalé ; un jour déjà saisi porte son existant", async () => {
    comme("ADMIN");
    const id = await emp();
    const m = (await prisma.employee.findUniqueOrThrow({ where: { id } })).matricule;
    await prisma.overtimeEntry.create({ data: { employeeId: id, date: jourPur("2026-10-13"), heuresTravaillees: 7 } });
    const csv = [
      "ID,Date/Heure",
      `${m},05/10/2026 08:00`, `${m},05/10/2026 17:00`,
      `${m},13/10/2026 08:00`, `${m},13/10/2026 16:30`,
      `${m},31/02/2026 08:00`,
    ].join("\n");
    const f = new FormData();
    f.set("fichier", new File([csv], "rapport.csv", { type: "text/csv" }));
    const a = await IMPORT.analyserPointageIVMS(null, f);
    expect(a.lignes.map((l) => l.date)).toEqual(["2026-10-05", "2026-10-13"]);
    expect(a.lignes[0].existant).toBeNull();
    expect(a.lignes[1].existant).toEqual({ heures: 7, code: null });
    const illisible = a.anomalies.find((x) => x.type === "LIGNE_ILLISIBLE");
    expect(illisible?.detail).toContain("Ligne 6");
    expect(illisible?.detail).toContain("31/02/2026 08:00");
  });
});

describe("11 — scan QR : l'interrupteur de l'espace salarié fait foi", () => {
  it("espace éteint : le scan est refusé, rien n'est écrit", async () => {
    const id = await emp();
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: false } });
    comme("EMPLOYE", id);
    const r = await POINTAGE.scannerAffiche({ code: "X", position: null } as never);
    expect(r).toMatchObject({ erreur: expect.stringContaining("espace salarié est désactivé") });
    expect(await prisma.scanPointage.count({ where: { employeeId: id } })).toBe(0);
    comme("ADMIN");
  });
});

describe("12 — « HS valorisées » de l'écran Présences = le montant de la paie", () => {
  it("même prime d'heures supp. que le bulletin (taux du contrat, brut reconstitué), back-office « — »", async () => {
    comme("ADMIN");
    const id = await emp();
    // Temps partiel (36 h/semaine, 8 h/jour) : la paie paie au taux du contrat, 300 ÷ (36 × 52/12) ≈ 1,92 $/h ;
    // l'ancien écran prenait 300 ÷ 26 ÷ 8 ≈ 1,44 $/h. (Les deux coïncident pour 48 h / 8 h.)
    await prisma.employee.update({ where: { id }, data: { heuresHebdomadaires: 36 } });
    const bo = await emp({ categorie: "BACKOFFICE" });
    // Une semaine à 60 h pour le brigade, en octobre 2026.
    for (const [i, date] of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].entries()) {
      await prisma.attendance.create({ data: { employeeId: id, date: jourPur(date), code: "P" } });
      await prisma.overtimeEntry.create({ data: { employeeId: id, date: jourPur(date), heuresTravaillees: i === 0 ? 20 : 10 } });
      await prisma.overtimeEntry.create({ data: { employeeId: bo, date: jourPur(date), heuresTravaillees: 12 } });
    }
    const parametres = await chargerParametresPaie();
    const emps = await prisma.employee.findMany({ where: { id: { in: [id, bo] } } });
    const hs = await hsValoriseesPaie(10, 2026, emps, parametres);
    const bulletin = await calculerBulletinLive(id, 10, 2026);
    expect(hs.get(id)?.montant).toBeGreaterThan(0);
    expect(hs.get(id)?.montant).toBe(bulletin!.ligne.hsValorisee);
    expect(hs.get(bo)?.montant).toBeNull();
  });
});

describe("13 — mineurs : identifiants, remplaçant", () => {
  const champs = (o: Record<string, string>) => ({
    sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: "300", dateEmbauche: "2024-01-01", contrat: "CDI",
    transportJourCDF: "0", transportMoisCDF: "0", transportMoisUSD: "0", cnssMontant: "0", enfants: "0", heuresParJour: "8", heuresHebdomadaires: "48", fraisMedicauxMoisCourant: "0", type: "NATIONAL", ...o,
  });
  it("ID IVMS déjà pris : refus qui nomme l'autre salarié ; matricule vide ou pris : message lisible", async () => {
    comme("ADMIN");
    const a = await emp();
    await prisma.employee.update({ where: { id: a }, data: { idExterneIVMS: "17" } });
    const nomA = (await prisma.employee.findUniqueOrThrow({ where: { id: a } })).nom;
    const b = await emp();
    const { matricule: mB, nom: nomB } = await prisma.employee.findUniqueOrThrow({ where: { id: b } });
    expect(await url(RH.modifierEmploye(b, fd(champs({ matricule: mB, nom: nomB, idExterneIVMS: "17" }))))).toContain(`déjà l'identifiant de pointeuse de ${nomA}`);
    expect(await url(RH.modifierEmploye(b, fd(champs({ matricule: "", nom: nomB }))))).toContain("matricule ne peut pas être vide");
    const mA = (await prisma.employee.findUniqueOrThrow({ where: { id: a } })).matricule;
    expect(await url(RH.modifierEmploye(b, fd(champs({ matricule: mA, nom: nomB }))))).toContain(`est déjà celui de ${nomA}`);
  });

  it("un remplaçant lui-même en congé approuvé sur ces dates est refusé", async () => {
    comme("ADMIN");
    const titulaire = await emp();
    const remplacant = await emp();
    await prisma.leaveRequest.create({ data: { employeeId: remplacant, type: "Congé annuel", dateDebut: jourPur("2027-04-05"), dateFin: jourPur("2027-04-09"), nbJours: 5, statut: "APPROUVE" } });
    const r = await url(CONGES.demanderConge(fd({ employeeId: titulaire, type: "Congé annuel", dateDebut: "2027-04-08", dateFin: "2027-04-10", nbJours: "3", remplacantId: remplacant })));
    expect(r).toContain("ne peut pas remplacer");
    expect(await prisma.leaveRequest.count({ where: { employeeId: titulaire } })).toBe(0);
  });
});

void adminId;
