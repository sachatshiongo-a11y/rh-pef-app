// Fuseau de Kinshasa (UTC+1) AVANT toute date : une date de fin reconstruite en heure LOCALE
// (minuit local = 23:00 UTC la veille) doit faire rougir le test du CDD qui finit le 30/09.
process.env.TZ = "Africa/Kinshasa";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { pariteSemaine } from "@/lib/dates-fr";
import { calculerReferenceMois } from "@/lib/paie-reference";

// Assemblage des jours de paie depuis la base : créneau de travail vs créneau SYSTÈME, modèle A/B,
// taux de rôle, horodatages de saisie, fin du contrat qui couvre le mois. C'est ici que « ce qui
// est posé au planning » devient une durée payée : une erreur d'assemblage change un montant sans
// qu'aucun test pur ne le voie.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { chargerJoursMois } = await import("./paie-reference-donnees");
const { chargerParametresPaie } = await import("./config");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let avecId: string;
let sansId: string;
let fin28Id: string;
let fin30Id: string;
let cdiId: string;
let transformeId: string;
let finAnterieureId: string;
let finPosterieureId: string;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SAMEDI_A = pariteSemaine(d("2026-09-19")); // couche du modèle posée pour le samedi 19, pas le 12

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Assistante", secteur: "Admin", categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0 };
  const creer = async (matricule: string, nom: string) =>
    (await prisma.employee.create({ data: { ...base, matricule, nom, heuresParJour: 8, heuresHebdomadaires: 48 } })).id;
  avecId = (await prisma.employee.create({ data: { ...base, matricule: "AV01-PEF", nom: "Avec Planning", heuresParJour: 9, heuresHebdomadaires: 51.92 } })).id;
  sansId = (await prisma.employee.create({ data: { ...base, matricule: "SA01-PEF", nom: "Sans Rien" } })).id;
  fin28Id = await creer("F28-PEF", "Fin Le 28");
  fin30Id = await creer("F30-PEF", "Fin Le 30");
  cdiId = await creer("CDI-PEF", "En CDI");
  transformeId = await creer("TRF-PEF", "CDD Devenu CDI");
  finAnterieureId = await creer("ANT-PEF", "Renouvelé Par Avenant");
  finPosterieureId = await creer("POS-PEF", "Fin En Décembre");

  const journee = await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } });
  const admin = await prisma.shift.create({ data: { nom: "Admin", heureDebut: "09:30", heureFin: "13:00", dureeHeures: 3.5, tauxHoraireUSD: 4 } });
  // Shift système portant une durée (modifiable dans l'écran des shifts) : il reste 0 h de travail.
  const conge = await prisma.shift.create({ data: { nom: "Congé", systeme: true, dureeHeures: 8 } });
  const huit = await prisma.shift.create({ data: { nom: "Huit heures", heureDebut: "08:00", heureFin: "16:00" } });
  await prisma.planningCreneau.createMany({ data: [
    { employeeId: avecId, date: d("2026-09-14"), shiftId: journee.id },
    { employeeId: avecId, date: d("2026-09-15"), shiftId: conge.id },
    { employeeId: avecId, date: d("2026-09-16"), shiftId: admin.id },
  ] });
  // Planning COMPLET de septembre (lun→sam, 8 h) pour les deux CDD : seule la date de fin les sépare.
  const lunSam: Date[] = [];
  for (let n = 1; n <= 30; n++) { const j = new Date(Date.UTC(2026, 8, n)); if (j.getUTCDay() !== 0) lunSam.push(j); }
  await prisma.planningCreneau.createMany({ data: [fin28Id, fin30Id].flatMap((employeeId) => lunSam.map((date) => ({ employeeId, date, shiftId: huit.id }))) });
  await prisma.planningModele.createMany({ data: [
    { employeeId: avecId, jour: 4, semaine: 0, shiftId: journee.id }, // jeudi, chaque semaine
    { employeeId: avecId, jour: 6, semaine: SAMEDI_A, shiftId: journee.id }, // samedi, une semaine sur deux
  ] });
  await prisma.attendance.create({ data: { employeeId: avecId, date: d("2026-09-17"), code: "C" } });
  await prisma.attendance.create({ data: { employeeId: avecId, date: d("2026-09-14"), code: "P" } });
  await prisma.attendance.create({ data: { employeeId: avecId, date: d("2026-09-18"), code: "S" } });
  await prisma.overtimeEntry.create({ data: { employeeId: avecId, date: d("2026-09-14"), heuresTravaillees: 9 } });

  const contrat = { heuresHebdo: 48, salaireMensuel: 300, poste: "Commis" };
  await prisma.contrat.createMany({ data: [
    { ...contrat, employeeId: fin28Id, type: "CDD", dateDebut: d("2026-03-01"), dateFin: d("2026-09-28") },
    { ...contrat, employeeId: fin30Id, type: "CDD", dateDebut: d("2026-03-01"), dateFin: d("2026-09-30") },
    { ...contrat, employeeId: cdiId, type: "CDI", dateDebut: d("2025-01-06"), dateFin: null },
    // CDD transformé en CDI le 16/09 : l'ancien finit dans le mois, le nouveau continue → pas de fin.
    { ...contrat, employeeId: transformeId, type: "CDD", dateDebut: d("2026-03-01"), dateFin: d("2026-09-15"), statut: "TRANSFORME" },
    { ...contrat, employeeId: transformeId, type: "CDI", dateDebut: d("2026-09-16"), dateFin: null },
    // Un CDD fini en août (hors mois) + un CDD en cours qui finit le 20/09 : c'est le 20/09 qui compte.
    { ...contrat, employeeId: finAnterieureId, type: "CDD", dateDebut: d("2026-03-01"), dateFin: d("2026-08-31"), statut: "EXPIRE" },
    { ...contrat, employeeId: finAnterieureId, type: "CDD", dateDebut: d("2026-09-01"), dateFin: d("2026-09-20") },
    { ...contrat, employeeId: finPosterieureId, type: "CDD", dateDebut: d("2026-03-01"), dateFin: d("2026-12-31") },
  ] });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("chargerJoursMois", () => {
  it("un jour par jour du mois, pour chaque salarié demandé, même sans aucune donnée", async () => {
    const m = await chargerJoursMois(9, 2026, [avecId, sansId]);
    expect(m.get(avecId)!.jours).toHaveLength(30);
    expect(m.get(sansId)!.jours).toHaveLength(30);
    expect(m.get(sansId)!.jours.every((j) => j.heuresModele === null && !j.aUnCreneau && j.heuresFaites === 0)).toBe(true);
    expect(m.get(sansId)!.jours.map((j) => j.date.getUTCDate())).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // Février : 28 jours, bornes du mois respectées.
    expect((await chargerJoursMois(2, 2026, [sansId])).get(sansId)!.jours).toHaveLength(28);
  });

  it("créneau de travail, créneau système, durée explicite et taux de rôle", async () => {
    const jours = (await chargerJoursMois(9, 2026, [avecId])).get(avecId)!.jours;
    const le = (n: number) => jours[n - 1];
    expect(le(14)).toMatchObject({ heuresPlanifiees: 9, aUnCreneau: true, code: "P", heuresFaites: 9, tauxRole: null });
    expect(le(15)).toMatchObject({ heuresPlanifiees: 0, aUnCreneau: true }); // Congé : système = 0 h
    expect(le(16)).toMatchObject({ heuresPlanifiees: 3.5, tauxRole: 4 });
    expect(le(17)).toMatchObject({ heuresPlanifiees: 0, aUnCreneau: false, code: "C", heuresModele: 9 });
    expect(le(18)).toMatchObject({ code: "S", aUnCreneau: false }); // congé sans solde transmis tel quel
    expect(le(19).heuresModele).toBe(9); // samedi de la bonne parité
    expect(le(12).heuresModele).toBe(0); // samedi de l'autre semaine : le modèle ne prévoit rien
    expect(le(13).heuresModele).toBe(0); // dimanche
  });

  it("horodatages de saisie recopiés pour les avertissements", async () => {
    const s = (await chargerJoursMois(9, 2026, [avecId])).get(avecId)!.saisie;
    const j14 = s[13];
    expect(j14.code).toBe("P");
    expect(j14.codeSaisiLe).toBeInstanceOf(Date);
    expect(j14.heuresSaisiesLe).toBeInstanceOf(Date);
    expect(j14.heuresModifieesLe).toBeInstanceOf(Date);
    expect(j14.creneauModifieLe).toBeInstanceOf(Date);
    expect(j14.heuresPlanifiees).toBe(9);
    expect(s[16].creneauModifieLe).toBeNull();
  });
});

describe("chargerJoursMois — fin du contrat qui couvre le mois", () => {
  it("le fuseau du test est bien Kinshasa (sinon le piège du minuit local n'est pas testé)", () => {
    expect(new Date(2026, 8, 30).toISOString()).toBe("2026-09-29T23:00:00.000Z");
  });

  it("date PURE du contrat en cours ; null pour un CDI, une fin après le mois, ou sans contrat", async () => {
    const m = await chargerJoursMois(9, 2026, [fin28Id, fin30Id, cdiId, transformeId, finAnterieureId, finPosterieureId, sansId]);
    const fin = (id: string) => m.get(id)!.dateFinContrat;
    expect(fin(fin28Id)?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(fin(fin30Id)?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(fin(cdiId)).toBeNull();
    expect(fin(transformeId)).toBeNull(); // CDD → CDI dans le mois : l'emploi continue
    expect(fin(finAnterieureId)?.toISOString()).toBe("2026-09-20T00:00:00.000Z"); // la fin d'août est ignorée
    expect(fin(finPosterieureId)).toBeNull();
    expect(fin(sansId)).toBeNull();
    // Le mois suivant, le CDD du 28/09 ne couvre plus rien.
    expect((await chargerJoursMois(10, 2026, [fin28Id])).get(fin28Id)!.dateFinContrat).toBeNull();
  });

  it("bout en bout : un CDD qui finit le 28/09 se replie avec un motif daté, celui du 30/09 non", async () => {
    const params = await chargerParametresPaie();
    const m = await chargerJoursMois(9, 2026, [fin28Id, fin30Id]);
    const reference = (id: string) => calculerReferenceMois({
      annee: 2026, mois: 9, jours: m.get(id)!.jours, salaireMensuel: 300, heuresHebdomadaires: 48, heuresParJour: 8,
      dateEmbauche: d("2025-01-06"), dateFinContrat: m.get(id)!.dateFinContrat, joursFeries: new Set(), joursCongePris: 0,
      referencePlanningDepuis: params.referencePlanningDepuis ?? null, params,
    });
    const r28 = reference(fin28Id);
    expect(r28.source).toBe("CONTRAT_REPLI");
    expect(r28.motif).toBe("Fin de contrat le 28/09/2026 : mois incomplet");
    const r30 = reference(fin30Id);
    expect(r30.source).toBe("PLANNING");
    expect(r30.motif).toBeNull();
  });
});
