import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// BALAYAGE ANTI-FAUX-REFUS (relecture du 2026-10-13). Depuis que la validation compare TOUS les
// montants figés, une ligne que rien n'a touché depuis son calcul ne doit JAMAIS être refusée :
// la valeur lue en base (Decimal(·, 2)) et le recalcul (nombre JavaScript) doivent s'accorder pour
// chaque régime de paie, à un taux de change « vilain » (beaucoup de décimales, demi-centimes).
// Le panel couvre : brigade sur heures planifiées avec heures supp., dimanche et férié ; maladie
// justifiée ; congé à cheval sur deux mois ; back-office avec absences, maladie non justifiée,
// entrée en cours de mois, avantages en nature, prêt, frais médicaux ; salarié sorti en cours de
// mois ; stagiaire. Chaque test relance le calcul puis vérifie que le contrôle laisse tout passer.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { rafraichirPaieDuMois, rafraichirPaieAffichee } = await import("./paie-refresh");
const { controlerLignesAValider, champsDifferents } = await import("./paie-validation");
const { calculerLignesPaie } = await import("./paie-batch");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let journee = "";
const d = (n: number, mois = 9) => new Date(Date.UTC(2026, mois - 1, n));
const SAISI = new Date("2026-10-01T08:00:00Z");
const joursOuvres = (mois: number) =>
  Array.from({ length: new Date(Date.UTC(2026, mois, 0)).getUTCDate() }, (_, i) => d(i + 1, mois)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);

async function emp(data: Record<string, unknown>) {
  return (await prisma.employee.create({ data: {
    sexe: "F", etatCivil: "Célibataire", poste: "Poste", secteur: "Cuisine", enfants: 0, contrat: "CDI",
    dateEmbauche: new Date("2024-01-01T00:00:00Z"), ...data,
  } as never })).id;
}

/** Calcule le mois puis vérifie : aucune ligne comptée n'est refusée par le contrôle de validation. */
async function aucunFauxRefus() {
  await rafraichirPaieDuMois({ creerRun: true });
  const lignes = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 }, statutPaiement: "PAS_VALIDE" }, select: { id: true } });
  expect(lignes.length).toBeGreaterThanOrEqual(7);
  // Diagnostic lisible si ça échoue : champ par champ.
  const { lignes: recalculees } = await calculerLignesPaie(9, 2026, prisma);
  const stockees = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, include: { employee: true } });
  const ecarts = stockees.flatMap((l) => {
    const r = recalculees.find((x) => x.employee.id === l.employeeId);
    return r ? [{ nom: l.employee.nom, champs: champsDifferents(l as never, r.data) }].filter((e) => e.champs.length) : [];
  });
  expect(ecarts).toEqual([]);
  const ids = await prisma.$transaction((tx) => controlerLignesAValider(tx, lignes.map((l) => l.id), { verrouRun: "EXCLUSIF" }), { timeout: 60_000 });
  expect(ids.size).toBe(lignes.length);
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: exercice.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2837.3737, anneeCourante: 2026, moisCourant: 9 } });
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  await prisma.jourFerie.create({ data: { date: d(15), designation: "Jour férié d'essai", annee: 2026 } });

  // 1. Brigade : planning lun-ven, 11,37 h certains jours (heures supp.), un dimanche et le férié travaillés.
  const a = await emp({ matricule: "B1-PEF", nom: "Brigade Heures Supp", categorie: "BRIGADE", salaireMensuel: 317.77, heuresHebdomadaires: 45, heuresParJour: 9, transportJourCDF: 3333, enfants: 2 });
  await prisma.planningCreneau.createMany({ data: joursOuvres(9).map((date) => ({ employeeId: a, date, shiftId: journee })) });
  const jours = [...joursOuvres(9), d(6), d(13)];
  await prisma.attendance.createMany({ data: jours.map((date) => ({ employeeId: a, date, code: "P" as const, createdAt: SAISI, updatedAt: SAISI })) });
  await prisma.overtimeEntry.createMany({ data: jours.map((date, i) => ({ employeeId: a, date, heuresTravaillees: i % 3 === 0 ? 11.37 : 9.13, createdAt: SAISI, updatedAt: SAISI })) });

  // 2. Brigade : maladie justifiée, absence, congé à cheval août → septembre, congé sans solde.
  const b = await emp({ matricule: "B2-PEF", nom: "Brigade Maladie Conge", categorie: "BRIGADE", salaireMensuel: 289.99, heuresHebdomadaires: 48, heuresParJour: 8, transportJourCDF: 2500 });
  await prisma.planningCreneau.createMany({ data: joursOuvres(9).map((date) => ({ employeeId: b, date, shiftId: journee })) });
  const codes: [number, "P" | "M" | "A" | "N" | "C" | "S" | "O", boolean][] = [[1, "C", false], [2, "C", false], [3, "C", false], [4, "M", true], [7, "M", false], [8, "A", false], [9, "N", false], [10, "S", false], [11, "O", false]];
  await prisma.attendance.createMany({ data: [
    ...codes.map(([n, code, maladieJustifiee]) => ({ employeeId: b, date: d(n), code, maladieJustifiee, createdAt: SAISI, updatedAt: SAISI })),
    ...joursOuvres(9).filter((x) => x.getUTCDate() >= 14).map((date) => ({ employeeId: b, date, code: "P" as const, createdAt: SAISI, updatedAt: SAISI })),
  ] });
  await prisma.overtimeEntry.createMany({ data: joursOuvres(9).filter((x) => x.getUTCDate() >= 14).map((date) => ({ employeeId: b, date, heuresTravaillees: 8.5, createdAt: SAISI, updatedAt: SAISI })) });
  await prisma.leaveRequest.create({ data: { employeeId: b, type: "Congé annuel", dateDebut: d(27, 8), dateFin: d(3), nbJours: 6, statut: "APPROUVE" } });

  // 3. Back-office : entrée en cours de mois, 3 enfants, avantages, prime, acompte, prêt, frais médicaux.
  const c = await emp({ matricule: "O1-PEF", nom: "Bureau Entree Milieu", categorie: "BACKOFFICE", salaireMensuel: 733.33, transportMoisUSD: 41.67, enfants: 3, dateEmbauche: d(14), fraisMedicauxMoisCourant: 10.01 });
  await prisma.avantageNature.createMany({ data: [{ employeeId: c, nature: "Logement", montantUSD: 80.33, mois: 9, annee: 2026 }, { employeeId: c, nature: "Véhicule", montantUSD: 20.17, mois: 9, annee: 2026 }] });
  await prisma.prime.create({ data: { employeeId: c, nom: "Prime", montantUSD: 33.335, mois: 9, annee: 2026 } });
  await prisma.acompteSalaire.create({ data: { employeeId: c, montantUSD: 17.77, mois: 9, annee: 2026, statut: "APPROUVE" } });
  const pret = await prisma.pretPersonnel.create({ data: { employeeId: c, montantUSD: 100, retenueMensuelleUSD: 33.33 } });
  void pret;

  // 4. Back-office : absences N/S, maladie non justifiée, sorti en cours de mois (CDD terminé le 20).
  const e = await emp({ matricule: "O2-PEF", nom: "Bureau Sorti", categorie: "BACKOFFICE", salaireMensuel: 555.55, transportMoisUSD: 30, contrat: "CDD" });
  await prisma.contrat.create({ data: { employeeId: e, type: "CDD", dateDebut: d(1, 3), dateFin: d(20), salaireMensuel: 555.55, poste: "Assistante", statut: "ACTIF" } });
  await prisma.attendance.createMany({ data: [
    ...joursOuvres(9).filter((x) => x.getUTCDate() <= 20).map((date) => ({ employeeId: e, date, code: "P" as const, createdAt: SAISI, updatedAt: SAISI })),
  ] });
  await prisma.attendance.deleteMany({ where: { employeeId: e, date: { in: [d(2), d(3), d(4)] } } });
  await prisma.attendance.createMany({ data: [{ employeeId: e, date: d(2), code: "N", createdAt: SAISI, updatedAt: SAISI }, { employeeId: e, date: d(3), code: "S", createdAt: SAISI, updatedAt: SAISI }, { employeeId: e, date: d(4), code: "M", createdAt: SAISI, updatedAt: SAISI }] });

  // 5. Stagiaire.
  await emp({ matricule: "S1-PEF", nom: "Stagiaire Test", categorie: "BACKOFFICE", salaireMensuel: 150.5, transportMoisUSD: 12.34, contrat: "STAGE" });
  // 6. Back-office ordinaire, 1 enfant, salaire à demi-centime délicat.
  await emp({ matricule: "O3-PEF", nom: "Bureau Ordinaire", categorie: "BACKOFFICE", salaireMensuel: 1234.57, transportMoisUSD: 0, enfants: 1 });
  // 7. Brigade sans aucune donnée.
  await emp({ matricule: "B3-PEF", nom: "Brigade Vide", categorie: "BRIGADE", salaireMensuel: 200, heuresHebdomadaires: 48, heuresParJour: 8 });
}, 240_000);
afterAll(async () => { await fermer?.(); });

describe("aucun faux refus : une ligne que rien n'a touché passe toujours le contrôle", () => {
  it("salaires saisis en NET (facteur de reconstitution), taux 2 837,3737", async () => {
    await aucunFauxRefus();
    // Le panel exerce bien ce qu'il prétend exercer (sinon le balayage serait creux).
    const l = async (matricule: string) => prisma.payrollLine.findFirstOrThrow({ where: { employee: { matricule }, payrollRun: { mois: 9, annee: 2026 } } });
    const n = (v: unknown) => Number(v);
    expect(n((await l("B1-PEF")).heuresSupp30)).toBeGreaterThan(0);
    expect(n((await l("B1-PEF")).heuresSupp100)).toBeGreaterThan(0);
    expect((await l("B2-PEF")).joursMaladieJustifies).toBeGreaterThan(0);
    expect(n((await l("B2-PEF")).indemniteCongesUSD)).toBeGreaterThan(0);
    expect(n((await l("O1-PEF")).avantagesNatureUSD)).toBe(100.5);
    expect((await l("O1-PEF")).prorataJoursTravailles).not.toBeNull();
    expect(n((await l("O1-PEF")).retenuePretUSD)).toBe(33.33);
    expect(n((await l("O2-PEF")).retenueAbsencesUSD)).toBeGreaterThan(0);
    expect(n((await l("O2-PEF")).retenueMaladieUSD)).toBeGreaterThan(0);
    expect(n((await l("O3-PEF")).inppUSD)).toBeGreaterThan(0);
    expect(n((await l("S1-PEF")).coutEmployeurCDF)).toBeGreaterThan(0);
  });

  it("salaires saisis en BRUT", async () => {
    const ex = await prisma.exerciceFiscal.findFirstOrThrow({ where: { actif: true } });
    await prisma.parametreLegal.update({ where: { exerciceId_cle: { exerciceId: ex.id, cle: "salaires_saisis_en_net" }, }, data: { valeur: 0 } });
    await aucunFauxRefus();
  });

  it("recalcul répété : toujours rien de refusé (idempotence)", async () => {
    await aucunFauxRefus();
    await aucunFauxRefus();
  });

  it("taux du jour changé APRÈS le calcul, page non rechargée : refus qui nomme les francs ; page rechargée : passe", async () => {
    await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: 2901.11 } });
    const lignes = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, select: { id: true } });
    await expect(prisma.$transaction((tx) => controlerLignesAValider(tx, lignes.map((l) => l.id), { verrouRun: "EXCLUSIF" }))).rejects.toThrow(/en francs/);
    await rafraichirPaieAffichee(9, 2026); // ouverture de la page : l'empreinte contient Config
    const rechargees = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, select: { id: true } });
    const ids = await prisma.$transaction((tx) => controlerLignesAValider(tx, rechargees.map((l) => l.id), { verrouRun: "EXCLUSIF" }));
    expect(ids.size).toBe(lignes.length);
  });

  it("ligne écrite par une ancienne version du moteur : refusée, puis recalculée à l'ouverture après un déploiement (autre commit)", async () => {
    const lignes = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, select: { id: true, inppUSD: true, coutEmployeurUSD: true, employee: { select: { nom: true } } } });
    const cible = lignes.find((l) => Number(l.inppUSD) > 0)!;
    // Ancienne version : coût employeur sans l'INPP, INPP non écrit.
    await prisma.payrollLine.update({ where: { id: cible.id }, data: { coutEmployeurUSD: Number(cible.coutEmployeurUSD) - Number(cible.inppUSD), inppUSD: 0 } });
    await expect(prisma.$transaction((tx) => controlerLignesAValider(tx, lignes.map((l) => l.id), { verrouRun: "EXCLUSIF" }))).rejects.toThrow(/INPP/);
    // Même commit, empreinte « à jour » dans la garde de 10 minutes : l'ouverture ne recalcule PAS (une retouche faite hors calcul
    // sur une ligne non figée change l'empreinte des lignes, donc recalcule : vérifié ici).
    await rafraichirPaieAffichee(9, 2026);
    const rechargees = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, select: { id: true } });
    const ids = await prisma.$transaction((tx) => controlerLignesAValider(tx, rechargees.map((l) => l.id), { verrouRun: "EXCLUSIF" }));
    expect(ids.size).toBe(lignes.length);
  });

  it("un déploiement (autre commit) fait recalculer les lignes à l'ouverture, un même commit non : les lignes d'une version antérieure du moteur sont remises à jour", async () => {
    const ids = async () => (await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, select: { id: true } })).map((l) => l.id).sort();
    const avant = process.env.RENDER_GIT_COMMIT;
    try {
      process.env.RENDER_GIT_COMMIT = "commit-ancien";
      await rafraichirPaieDuMois({ creerRun: true }); // calcul par l'ancienne version
      const calculees = await ids();
      await rafraichirPaieAffichee(9, 2026);
      expect(await ids()).toEqual(calculees); // même commit, rien n'a bougé : pas de recalcul
      process.env.RENDER_GIT_COMMIT = "commit-nouveau";
      await rafraichirPaieAffichee(9, 2026);
      expect(await ids()).not.toEqual(calculees); // nouveau commit : recalculées (brouillons remplacés)
    } finally {
      if (avant === undefined) delete process.env.RENDER_GIT_COMMIT; else process.env.RENDER_GIT_COMMIT = avant;
    }
  });

  it("arrondi des DEUX côtés : un nombre écrit par Prisma dans Decimal(·, 2) est relu comme le comparateur l'arrondit (demi-centimes, bruit binaire)", async () => {
    const { lignes } = await calculerLignesPaie(9, 2026, prisma);
    const cible = lignes.find((l) => l.employee.matricule === "B1-PEF")!;
    const ligne = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: cible.employee.id, payrollRun: { mois: 9, annee: 2026 } } });
    const valeurs = [1.005, 2.675, 0.285, 10.125, 1.0049999999, 1.015, 8.345, 0.1 + 0.2, 7.0000001, 1e-7, 173.33333333333334, 216.66666666666666, 0.575, 4.35 * 100 / 100, 1.255, 33.335, 99.995, 0.005, 0.004999];
    for (const v of valeurs) {
      await prisma.payrollLine.update({ where: { id: ligne.id }, data: { heuresSupp30: v, heuresTravaillees: v, primesUSD: v, coutEmployeurCDF: v } });
      const lue = await prisma.payrollLine.findUniqueOrThrow({ where: { id: ligne.id } });
      const recalcul = { ...cible.data, heuresSupp30: v, heuresTravaillees: v, primesUSD: v, coutEmployeurCDF: v };
      const ecart = champsDifferents(lue as never, recalcul).filter((c) => ["heuresSupp30", "heuresTravaillees", "primesUSD", "coutEmployeurCDF"].includes(c));
      expect({ v, ecart }).toEqual({ v, ecart: [] });
    }
  });
});
