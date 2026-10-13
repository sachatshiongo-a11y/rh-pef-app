import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// RECALCUL UTILE (perf, 2026-10-13) : ouvrir « Paie » ou « À valider » ne recalcule plus les bulletins du
// mois que si une donnée source a changé depuis le dernier calcul (lib/paie-empreinte.ts). EXIGENCE
// D'ARGENT : la paie affichée est STRICTEMENT celle qu'un recalcul forcé donnerait, ligne par ligne,
// champ par champ. Ce test de propriété applique, un par un, un changement sur CHAQUE table que lit le
// moteur (et plusieurs colonnes de la fiche), ouvre la paie par le chemin d'affichage, puis la compare à
// un recalcul forcé. Si une source échappait à l'empreinte, l'affichage resterait sur l'ancien calcul et
// l'égalité tomberait (voir les falsifications du rapport).

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, avance: 0 }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => null, requireModule: () => {}, requireRole: () => {}, invaliderProfil: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { rafraichirPaieAffichee, rafraichirPaieDuMois } = await import("@/lib/paie-refresh");
const { empreinteDuMois, texteEmpreinte, GARDE_RECALCUL_MS } = await import("@/lib/paie-empreinte");
const { STATUTS_FIGES } = await import("@/lib/paie-refresh");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const E = { ada: "", bob: "", cleo: "", dan: "", eva: "" };
const S = { journee: "", court: "" };
let exerciceId = 0;
const nowOrig = Date.now;

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);
const cleJour = (employeeId: string, date: Date) => ({ employeeId_date: { employeeId, date } });

async function salarie(matricule: string, nom: string, extra: Record<string, unknown> = {}) {
  return (await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Poste", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel: 300, heuresHebdomadaires: 45, heuresParJour: 9, enfants: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDI", ...extra,
  } as never })).id;
}
async function brigade(matricule: string, nom: string, extra: Record<string, unknown> = {}) {
  const id = await salarie(matricule, nom, extra);
  await prisma.contrat.create({ data: { employeeId: id, type: (extra.contrat as "CDI" | "CDD") ?? "CDI", dateDebut: new Date("2025-01-06T00:00:00Z"), salaireMensuel: 300, poste: "Poste", dateFin: extra.contrat === "CDD" ? new Date("2027-01-05T00:00:00Z") : null } });
  await prisma.planningCreneau.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, shiftId: S.journee })) });
  await prisma.attendance.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, code: "P" })) });
  await prisma.overtimeEntry.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, heuresTravaillees: 9 })) });
  return id;
}

/** Les lignes du mois telles que la base les garde (hors identifiant), par salarié. */
async function instantane() {
  const run = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 }, include: { lignes: true } });
  const lignes = Object.fromEntries(run.lignes.map(({ id: _id, payrollRunId: _r, ...reste }) => [reste.employeeId, JSON.parse(JSON.stringify(reste))]));
  return JSON.parse(JSON.stringify({ taux: String(run.tauxChangeUtilise), lignes }));
}
const idsLignes = async () => (await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, select: { id: true }, orderBy: { id: "asc" } })).map((l) => l.id);
const run = () => prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 } });
const empreinteCourante = async () => {
  const r = await run();
  return texteEmpreinte(await empreinteDuMois(prisma, { mois: 9, annee: 2026, runId: r.id, statutsFiges: STATUTS_FIGES }));
};

type Mutation = { nom: string; appliquer: () => Promise<unknown>; change: boolean; retablit?: boolean };

/** Le cœur de la propriété : appliquer, ouvrir par l'AFFICHAGE, comparer à un recalcul FORCÉ. */
async function verifier(m: Mutation) {
  const avant = await instantane();
  const empreinteAvant = await empreinteCourante();
  await m.appliquer();
  expect(await empreinteCourante(), `${m.nom} : l'empreinte doit changer`).not.toBe(empreinteAvant);

  await rafraichirPaieAffichee(9, 2026); // ouverture de Paie / À valider
  const affiche = await instantane();
  const idsAffiches = await idsLignes();

  // Une fois recalculée, l'ouverture suivante ne recalcule plus rien (même lignes, mêmes identifiants).
  await rafraichirPaieAffichee(9, 2026);
  expect(await idsLignes(), `${m.nom} : la paie doit se stabiliser`).toEqual(idsAffiches);

  await rafraichirPaieDuMois({ creerRun: false }); // recalcul FORCÉ : la référence
  const force = await instantane();
  expect(affiche, `${m.nom} : l'affichage doit être identique à un recalcul forcé`).toEqual(force);
  if (m.change) expect(affiche, `${m.nom} : le changement doit se voir sur la paie`).not.toEqual(avant);
  // Une retouche faite hors du calcul est effacée : la paie revient exactement à ce qu'elle était.
  if (m.retablit) expect(affiche, `${m.nom} : la paie doit revenir à son état calculé`).toEqual(avant);
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  exerciceId = exercice.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  await prisma.typeConge.createMany({ data: [
    { nom: "Congé annuel", joursPayes: 18, tauxPct: 100, compteDansSolde: true },
    { nom: "Congé sans solde", joursPayes: 0, tauxPct: 0 },
  ] });
  S.journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  S.court = (await prisma.shift.create({ data: { nom: "Court", heureDebut: "08:00", heureFin: "12:00" } })).id;
  E.ada = await brigade("AK01-PEF", "Ada Kalala", { contrat: "CDD" });
  E.bob = await brigade("BB01-PEF", "Bob Banza");
  E.eva = await brigade("EV01-PEF", "Eva Ilunga", { transportJourCDF: 5000 });
  E.cleo = await salarie("CL01-PEF", "Cléo Cibangu", { categorie: "BACKOFFICE", salaireMensuel: 600, enfants: 2, transportMoisUSD: 15, heuresHebdomadaires: 48 });
  await prisma.contrat.create({ data: { employeeId: E.cleo, type: "CDI", dateDebut: new Date("2025-01-06T00:00:00Z"), salaireMensuel: 600, poste: "Comptable" } });
  await prisma.attendance.createMany({ data: joursOuvres().map((date) => ({ employeeId: E.cleo, date, code: "P" })) });
  E.dan = await salarie("DN01-PEF", "Dan Mutombo", { categorie: "BACKOFFICE", salaireMensuel: 150, contrat: "STAGE" });
  await prisma.contrat.create({ data: { employeeId: E.dan, type: "STAGE", dateDebut: new Date("2026-06-01T00:00:00Z"), salaireMensuel: 150, poste: "Stagiaire" } });
  await prisma.attendance.createMany({ data: joursOuvres().map((date) => ({ employeeId: E.dan, date, code: "P" })) });
  await rafraichirPaieDuMois({ creerRun: true }); // « Calculer la paie du mois » : crée la run et enregistre l'empreinte
}, 180_000);
afterAll(async () => { await fermer?.(); });
afterEach(() => { H.avance = 0; vi.restoreAllMocks(); });

const m = (nom: string, change: boolean, appliquer: () => Promise<unknown>, retablit = false): Mutation => ({ nom, appliquer, change, retablit });

describe("l'ouverture de la paie ne recalcule pas quand rien n'a changé", () => {
  it("deux ouvertures de suite : mêmes identifiants de lignes, même instant de calcul, aucune écriture", async () => {
    const r0 = await run();
    expect(r0.empreinteCalcul).toMatch(/^v1:[0-9a-f]{32}:/);
    expect(r0.calculeLe).not.toBeNull();
    const ids0 = await idsLignes();
    const photo0 = await instantane();
    await rafraichirPaieAffichee(9, 2026);
    await rafraichirPaieAffichee(9, 2026);
    expect(await idsLignes()).toEqual(ids0);
    expect((await run()).calculeLe).toEqual(r0.calculeLe);
    expect(await instantane()).toEqual(photo0);
  });

  it("le bouton « Calculer » (recalcul forcé) recalcule toujours, même sans changement", async () => {
    const ids0 = await idsLignes();
    await rafraichirPaieDuMois({ creerRun: true, userId: (await prisma.user.create({ data: { email: "d1@pef.cd", nom: "Direction", role: "ADMIN" } })).id });
    const ids1 = await idsLignes();
    expect(ids1).not.toEqual(ids0); // brouillons sans historique : remplacés
    expect(ids1).toHaveLength(ids0.length);
  });

  it("la photo d'un salarié est la seule colonne de fiche ignorée : changer la photo ne recalcule pas", async () => {
    const e0 = await empreinteCourante();
    await prisma.employee.update({ where: { id: E.ada }, data: { photoUrl: "https://exemple.cd/photo.jpg" } });
    expect(await empreinteCourante()).toBe(e0);
    await prisma.employee.update({ where: { id: E.ada }, data: { photoUrl: null } });
  });

  it("une demande de congé EN ATTENTE ne change rien (le moteur ne lit que les congés approuvés)", async () => {
    const e0 = await empreinteCourante();
    const c = await prisma.leaveRequest.create({ data: { employeeId: E.cleo, type: "Congé annuel", dateDebut: d(28), dateFin: d(29), nbJours: 2 } });
    expect(await empreinteCourante()).toBe(e0);
    await prisma.leaveRequest.delete({ where: { id: c.id } });
  });
});

describe("garde temporelle et empreinte absente", () => {
  it("moins de 10 minutes : pas de recalcul ; au-delà : recalcul, même sans changement", async () => {
    const ids0 = await idsLignes();
    vi.spyOn(Date, "now").mockImplementation(() => nowOrig() + GARDE_RECALCUL_MS - 30_000);
    await rafraichirPaieAffichee(9, 2026);
    expect(await idsLignes()).toEqual(ids0);

    vi.spyOn(Date, "now").mockImplementation(() => nowOrig() + GARDE_RECALCUL_MS + 30_000);
    await rafraichirPaieAffichee(9, 2026);
    const ids1 = await idsLignes();
    expect(ids1).not.toEqual(ids0);
  });

  it("un dernier calcul daté du futur (horloges désaccordées) est traité comme échu", async () => {
    await prisma.payrollRun.updateMany({ where: { mois: 9, annee: 2026 }, data: { calculeLe: new Date(nowOrig() + 3_600_000) } });
    const ids0 = await idsLignes();
    await rafraichirPaieAffichee(9, 2026);
    expect(await idsLignes()).not.toEqual(ids0);
  });

  it("empreinte absente (run calculée avant la migration) : recalcul, puis empreinte enregistrée", async () => {
    await prisma.payrollRun.updateMany({ where: { mois: 9, annee: 2026 }, data: { empreinteCalcul: null, calculeLe: null } });
    const ids0 = await idsLignes();
    await rafraichirPaieAffichee(9, 2026);
    const ids1 = await idsLignes();
    expect(ids1).not.toEqual(ids0);
    const r = await run();
    expect(r.empreinteCalcul).not.toBeNull();
    await rafraichirPaieAffichee(9, 2026);
    expect(await idsLignes()).toEqual(ids1);
  });

  it("empreinte altérée : recalcul", async () => {
    await prisma.payrollRun.updateMany({ where: { mois: 9, annee: 2026 }, data: { empreinteCalcul: "v1:faux:faux" } });
    const ids0 = await idsLignes();
    await rafraichirPaieAffichee(9, 2026);
    expect(await idsLignes()).not.toEqual(ids0);
  });
});

describe("propriété : après CHAQUE changement de source, l'affichage = un recalcul forcé", () => {
  // Présences, heures, planning
  it("présence modifiée / supprimée / ajoutée", async () => {
    await verifier(m("présence modifiée (absence non justifiée)", true, () => prisma.attendance.update({ where: cleJour(E.ada, d(3)), data: { code: "N" } })));
    await verifier(m("présence supprimée", true, () => prisma.attendance.delete({ where: cleJour(E.bob, d(4)) })));
    await verifier(m("présence ajoutée un samedi", true, () => prisma.attendance.create({ data: { employeeId: E.bob, date: d(5), code: "P" } })));
    await verifier(m("maladie justifiée", true, () => prisma.attendance.update({ where: cleJour(E.cleo, d(7)), data: { code: "M", maladieJustifiee: true } })));
    await verifier(m("présence d'un back-office modifiée", true, () => prisma.attendance.update({ where: cleJour(E.cleo, d(8)), data: { code: "A" } })));
  });
  it("heures supplémentaires modifiées / supprimées / ajoutées", async () => {
    await verifier(m("heures modifiées", true, () => prisma.overtimeEntry.update({ where: cleJour(E.ada, d(8)), data: { heuresTravaillees: 12 } })));
    await verifier(m("heures supprimées", true, () => prisma.overtimeEntry.delete({ where: cleJour(E.bob, d(9)) })));
    await verifier(m("heures ajoutées un samedi", true, () => prisma.overtimeEntry.create({ data: { employeeId: E.eva, date: d(12), heuresTravaillees: 7 } })));
  });
  it("planning : créneau modifié / supprimé, modèle créé / modifié, shift modifié", async () => {
    await verifier(m("créneau changé", true, () => prisma.planningCreneau.update({ where: cleJour(E.bob, d(9)), data: { shiftId: S.court } })));
    await verifier(m("créneau supprimé", true, () => prisma.planningCreneau.delete({ where: cleJour(E.eva, d(10)) })));
    await verifier(m("créneau ajouté", true, () => prisma.planningCreneau.create({ data: { employeeId: E.eva, date: d(12), shiftId: S.journee } })));
    const modele = await prisma.planningModele.create({ data: { employeeId: E.eva, jour: 6, semaine: 0, shiftId: S.court } });
    await verifier(m("modèle de planning modifié", false, () => prisma.planningModele.update({ where: { id: modele.id }, data: { shiftId: S.journee } })));
    await verifier(m("modèle de planning supprimé", false, () => prisma.planningModele.delete({ where: { id: modele.id } })));
    await verifier(m("shift : heure de fin", true, () => prisma.shift.update({ where: { id: S.journee }, data: { heureFin: "18:00" } })));
    await verifier(m("shift : taux horaire de rôle", false, () => prisma.shift.update({ where: { id: S.journee }, data: { tauxHoraireUSD: 3 } })));
    await verifier(m("shift : durée explicite", true, () => prisma.shift.update({ where: { id: S.court }, data: { dureeHeures: 5 } })));
  });

  // Congés
  it("congés : approuvé, sans solde, dates modifiées, supprimé, taux du type", async () => {
    const conge = await prisma.leaveRequest.create({ data: { employeeId: E.cleo, type: "Congé annuel", dateDebut: d(28), dateFin: d(29), nbJours: 2 } });
    await verifier(m("congé approuvé", true, () => prisma.leaveRequest.update({ where: { id: conge.id }, data: { statut: "APPROUVE" } })));
    await verifier(m("congé : dates modifiées", true, () => prisma.leaveRequest.update({ where: { id: conge.id }, data: { dateFin: d(30), nbJours: 3 } })));
    await verifier(m("congé sans solde approuvé", true, () => prisma.leaveRequest.create({ data: { employeeId: E.bob, type: "Congé sans solde", dateDebut: d(15), dateFin: d(16), nbJours: 2, statut: "APPROUVE" } })));
    await verifier(m("taux du type de congé (sans solde → payé)", false, () => prisma.typeConge.update({ where: { nom: "Congé sans solde" }, data: { tauxPct: 50 } })));
    await verifier(m("congé supprimé", true, () => prisma.leaveRequest.delete({ where: { id: conge.id } })));
  });

  // Fiche
  it("fiche : salaire, enfants, transport, heures, frais médicaux, embauche, catégorie, nouveau salarié, désactivation", async () => {
    await verifier(m("salaire", true, () => prisma.employee.update({ where: { id: E.cleo }, data: { salaireMensuel: 650 } })));
    await verifier(m("enfants", true, () => prisma.employee.update({ where: { id: E.cleo }, data: { enfants: 3 } })));
    await verifier(m("transport mensuel", true, () => prisma.employee.update({ where: { id: E.cleo }, data: { transportMoisUSD: 25 } })));
    await verifier(m("transport journalier (brigade)", true, () => prisma.employee.update({ where: { id: E.eva }, data: { transportJourCDF: 6000 } })));
    await verifier(m("heures hebdomadaires", true, () => prisma.employee.update({ where: { id: E.ada }, data: { heuresHebdomadaires: 40 } })));
    await verifier(m("heures par jour", false, () => prisma.employee.update({ where: { id: E.ada }, data: { heuresParJour: 8 } })));
    await verifier(m("frais médicaux saisis sur la fiche", true, () => prisma.employee.update({ where: { id: E.cleo }, data: { fraisMedicauxMoisCourant: 15 } })));
    await verifier(m("date d'embauche dans le mois (prorata)", true, () => prisma.employee.update({ where: { id: E.cleo }, data: { dateEmbauche: new Date("2026-09-15T00:00:00Z") } })));
    await verifier(m("catégorie", true, () => prisma.employee.update({ where: { id: E.bob }, data: { categorie: "BACKOFFICE" } })));
    await verifier(m("indemnité du stagiaire", true, () => prisma.employee.update({ where: { id: E.dan }, data: { salaireMensuel: 200 } })));
    await verifier(m("nouveau salarié actif (sans ligne)", true, async () => { await salarie("NV01-PEF", "Nova Kabeya", { categorie: "BACKOFFICE", salaireMensuel: 400 }); }));
    await verifier(m("fiche désactivée", true, () => prisma.employee.update({ where: { id: E.eva }, data: { actif: false } })));
    await verifier(m("fiche réactivée", true, () => prisma.employee.update({ where: { id: E.eva }, data: { actif: true } })));
  });

  // Contrats
  it("contrats : régime, fin de contrat dans le mois, expiré", async () => {
    const cAda = await prisma.contrat.findFirstOrThrow({ where: { employeeId: E.ada } });
    await verifier(m("fin de contrat dans le mois", true, () => prisma.contrat.update({ where: { id: cAda.id }, data: { dateFin: new Date("2026-09-20T00:00:00Z") } })));
    await verifier(m("contrat expiré (régime de la fiche)", false, () => prisma.contrat.update({ where: { id: cAda.id }, data: { statut: "EXPIRE" } })));
    const cBob = await prisma.contrat.findFirstOrThrow({ where: { employeeId: E.bob } });
    await verifier(m("régime de paie : le contrat devient un stage", true, () => prisma.contrat.update({ where: { id: cBob.id }, data: { type: "STAGE" } })));
    await verifier(m("régime de paie : le contrat redevient un CDI", true, () => prisma.contrat.update({ where: { id: cBob.id }, data: { type: "CDI" } })));
    await verifier(m("régime de paie : un nouveau contrat ACTIF (intérim = hors calcul)", true, () => prisma.contrat.create({ data: { employeeId: E.bob, type: "INTERIM", dateDebut: new Date("2026-09-01T00:00:00Z"), salaireMensuel: 300, poste: "Intérim" } })));
  });

  // Éléments de paie
  it("prime, acompte, frais médicaux, avantage en nature : créés, modifiés, supprimés", async () => {
    let primeId = "", acompteId = "", fraisId = "", avantageId = "";
    await verifier(m("prime créée", true, async () => { primeId = (await prisma.prime.create({ data: { employeeId: E.cleo, nom: "Prime", montantUSD: 20, mois: 9, annee: 2026 } })).id; }));
    await verifier(m("prime modifiée", true, () => prisma.prime.update({ where: { id: primeId }, data: { montantUSD: 45 } })));
    await verifier(m("prime supprimée", true, () => prisma.prime.delete({ where: { id: primeId } })));

    await verifier(m("acompte en attente puis approuvé : créé approuvé", true, async () => { acompteId = (await prisma.acompteSalaire.create({ data: { employeeId: E.cleo, montantUSD: 40, mois: 9, annee: 2026, statut: "APPROUVE" } })).id; }));
    await verifier(m("acompte modifié", true, () => prisma.acompteSalaire.update({ where: { id: acompteId }, data: { montantUSD: 55 } })));
    await verifier(m("acompte supprimé", true, () => prisma.acompteSalaire.delete({ where: { id: acompteId } })));
    const attente = await prisma.acompteSalaire.create({ data: { employeeId: E.ada, montantUSD: 30, mois: 9, annee: 2026 } });
    await verifier(m("acompte approuvé (EN_ATTENTE → APPROUVE)", true, () => prisma.acompteSalaire.update({ where: { id: attente.id }, data: { statut: "APPROUVE" } })));

    await verifier(m("frais médicaux (table durable) créés", true, async () => { fraisId = (await prisma.fraisMedical.create({ data: { employeeId: E.ada, montantUSD: 12, mois: 9, annee: 2026 } })).id; }));
    await verifier(m("frais médicaux (table durable) modifiés", true, () => prisma.fraisMedical.update({ where: { id: fraisId }, data: { montantUSD: 18 } })));

    await verifier(m("avantage en nature créé (recopié sur le bulletin)", true, async () => { avantageId = (await prisma.avantageNature.create({ data: { employeeId: E.cleo, nature: "Logement", montantUSD: 100, mois: 9, annee: 2026 } })).id; }));
    await verifier(m("avantage en nature modifié", true, () => prisma.avantageNature.update({ where: { id: avantageId }, data: { montantUSD: 120 } })));
    await verifier(m("avantage en nature supprimé", true, () => prisma.avantageNature.delete({ where: { id: avantageId } })));
  });

  it("prêts : accordé, retenue mensuelle modifiée, retenue d'un mois antérieur, soldé", async () => {
    let pretId = "";
    await verifier(m("prêt en cours accordé", true, async () => { pretId = (await prisma.pretPersonnel.create({ data: { employeeId: E.cleo, montantUSD: 300, retenueMensuelleUSD: 50 } })).id; }));
    await verifier(m("prêt : retenue mensuelle modifiée", true, () => prisma.pretPersonnel.update({ where: { id: pretId }, data: { retenueMensuelleUSD: 60 } })));
    await verifier(m("retenue d'un mois antérieur enregistrée", true, () => prisma.retenuePret.create({ data: { pretId, mois: 8, annee: 2026, montantUSD: 270 } })));
    await verifier(m("retenue antérieure corrigée", true, () => prisma.retenuePret.updateMany({ where: { pretId }, data: { montantUSD: 100 } })));
    await verifier(m("prêt soldé", true, () => prisma.pretPersonnel.update({ where: { id: pretId }, data: { statut: "SOLDE" } })));
  });

  // Paramètres
  it("jour férié, taux de change, paramètres légaux, barème IPR, date d'effet, salaires en net", async () => {
    await verifier(m("jour férié créé", true, () => prisma.jourFerie.create({ data: { date: d(16), designation: "Férié test", annee: 2026 } })));
    await verifier(m("jour férié supprimé", true, () => prisma.jourFerie.deleteMany({ where: { date: d(16) } })));
    await verifier(m("taux de change", true, () => prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2450 } })));
    await verifier(m("paramètre légal : CNSS salarié", true, () => prisma.parametreLegal.updateMany({ where: { exerciceId, cle: "cnss_salarie" }, data: { valeur: 0.06 } })));
    await verifier(m("paramètre légal : seuil d'heures supp.", true, () => prisma.parametreLegal.updateMany({ where: { exerciceId, cle: "hs_seuil_hebdo_h" }, data: { valeur: 4 } })));
    await verifier(m("barème IPR", true, () => prisma.trancheIprCDF.updateMany({ where: { exerciceId, ordre: 2 }, data: { taux: 0.2 } })));
    await verifier(m("date d'effet de la paie planifiée", true, () => prisma.parametreLegal.updateMany({ where: { exerciceId, cle: "paie_reference_planning_depuis" }, data: { valeur: 202610 } })));
    await verifier(m("salaires saisis en net (interrupteur)", true, () => prisma.parametreLegal.create({ data: { exerciceId, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } })));
    await verifier(m("changement d'exercice fiscal actif", true, async () => {
      const prochain = await prisma.exerciceFiscal.create({ data: { annee: 2027, actif: false } });
      const params = await prisma.parametreLegal.findMany({ where: { exerciceId } });
      await prisma.parametreLegal.createMany({ data: params.map(({ id: _i, exerciceId: _e, updatedAt: _u, ...p }) => ({ ...p, exerciceId: prochain.id, valeur: p.cle === "inpp_taux" ? 0.05 : p.valeur })) });
      const tranches = await prisma.trancheIprCDF.findMany({ where: { exerciceId } });
      await prisma.trancheIprCDF.createMany({ data: tranches.map(({ id: _i, exerciceId: _e, ...t }) => ({ ...t, exerciceId: prochain.id })) });
      await prisma.exerciceFiscal.update({ where: { id: exerciceId }, data: { actif: false } });
      await prisma.exerciceFiscal.update({ where: { id: prochain.id }, data: { actif: true } });
    }));
  });

  // Les lignes elles-mêmes
  it("une ligne retouchée à la main, supprimée, ou une run au taux altéré : l'ouverture rétablit le calcul", async () => {
    await verifier(m("ligne brouillon retouchée en base", false, () => prisma.payrollLine.updateMany({ where: { employeeId: E.ada, payrollRun: { mois: 9, annee: 2026 } }, data: { salNetUSD: 1 } }), true));
    await verifier(m("taux de la run altéré", false, () => prisma.payrollRun.updateMany({ where: { mois: 9, annee: 2026 }, data: { tauxChangeUtilise: 1 } }), true));
    await verifier(m("ligne brouillon supprimée (réinitialisation partielle)", false, () => prisma.payrollLine.deleteMany({ where: { employeeId: E.cleo, payrollRun: { mois: 9, annee: 2026 } } }), true));
  });

  it("ligne figée : la source change pendant qu'elle est figée, puis on la rouvre — elle est recalculée", async () => {
    const l = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: E.cleo, payrollRun: { mois: 9, annee: 2026 } } });
    // Valider (état seul : le geste réel est couvert par paie-validation-controle).
    await prisma.payrollLine.update({ where: { id: l.id }, data: { statutPaiement: "VALIDE" } });
    await rafraichirPaieAffichee(9, 2026); // l'état de la ligne a changé : recalcul des autres, la figée reste
    const figee = JSON.stringify((await prisma.payrollLine.findUniqueOrThrow({ where: { id: l.id } })));

    // Pendant qu'elle est figée, sa source change : les autres lignes ne bougent pas, la sienne non plus.
    await prisma.prime.create({ data: { employeeId: E.cleo, nom: "Prime tardive", montantUSD: 77, mois: 9, annee: 2026 } });
    await rafraichirPaieAffichee(9, 2026);
    expect(JSON.stringify((await prisma.payrollLine.findUniqueOrThrow({ where: { id: l.id } })))).toBe(figee);

    // Rouverte : les sources n'ont PAS changé depuis le dernier calcul, mais la ligne est périmée.
    await verifier(m("ligne rouverte (VALIDE → PAS_VALIDE) après un changement de source", true, () => prisma.payrollLine.update({ where: { id: l.id }, data: { statutPaiement: "PAS_VALIDE" } })));
    expect(Number((await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: E.cleo, payrollRun: { mois: 9, annee: 2026 } } })).primesUSD)).toBeGreaterThan(0);
  });

  it("paie clôturée (toutes lignes validées, run VALIDE) : l'ouverture ne touche à rien", async () => {
    await prisma.payrollLine.updateMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, data: { statutPaiement: "VALIDE" } });
    await prisma.payrollRun.updateMany({ where: { mois: 9, annee: 2026 }, data: { statut: "VALIDE" } });
    const avant = JSON.stringify(await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, orderBy: { id: "asc" } }));
    await prisma.attendance.update({ where: cleJour(E.bob, d(14)), data: { code: "N" } }).catch(() => {});
    await rafraichirPaieAffichee(9, 2026);
    await rafraichirPaieAffichee(9, 2026);
    expect(JSON.stringify(await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, orderBy: { id: "asc" } }))).toBe(avant);
  });
});
