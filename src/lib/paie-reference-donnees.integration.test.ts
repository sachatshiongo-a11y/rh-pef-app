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
let echu01Id: string;
let repos29Id: string;
let presence29Id: string;
let heures29Id: string;
let congesId: string;
let ssFerieId: string;
let chevalId: string;
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
  echu01Id = await creer("E01-PEF", "CDD Échu Poursuivi"); // cas réel : Myriam Bumbakini
  repos29Id = await creer("R29-PEF", "Repos Après La Fin");
  presence29Id = await creer("P29-PEF", "Présente Après La Fin");
  heures29Id = await creer("H29-PEF", "Heures Après La Fin");
  congesId = await creer("CGS-PEF", "Congés Divers");
  ssFerieId = await creer("SSF-PEF", "Sans Solde Sur Férié");
  chevalId = await creer("CHV-PEF", "Semaine À Cheval");

  const journee = await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } });
  const admin = await prisma.shift.create({ data: { nom: "Admin", heureDebut: "09:30", heureFin: "13:00", dureeHeures: 3.5, tauxHoraireUSD: 4 } });
  // Shift système portant une durée (modifiable dans l'écran des shifts) : il reste 0 h de travail.
  const conge = await prisma.shift.create({ data: { nom: "Congé", systeme: true, dureeHeures: 8 } });
  const huit = await prisma.shift.create({ data: { nom: "Huit heures", heureDebut: "08:00", heureFin: "16:00" } });
  const repos = await prisma.shift.create({ data: { nom: "Repos", systeme: true } });
  await prisma.planningCreneau.createMany({ data: [
    { employeeId: avecId, date: d("2026-09-14"), shiftId: journee.id },
    { employeeId: avecId, date: d("2026-09-15"), shiftId: conge.id },
    { employeeId: avecId, date: d("2026-09-16"), shiftId: admin.id },
  ] });
  // Planning COMPLET de septembre (lun→sam, 8 h) pour le CDD du 30/09 et le CDD échu le 01/09 ; celui
  // du 28/09 s'arrête le 28 (lundi, créneau LE jour de la fin) : rien après sa fin, il se replie.
  const lunSam: Date[] = [];
  for (let n = 1; n <= 30; n++) { const j = new Date(Date.UTC(2026, 8, n)); if (j.getUTCDay() !== 0) lunSam.push(j); }
  await prisma.planningCreneau.createMany({ data: [
    ...[fin30Id, echu01Id].flatMap((employeeId) => lunSam.map((date) => ({ employeeId, date, shiftId: huit.id }))),
    ...lunSam.filter((date) => date.getUTCDate() <= 28).map((date) => ({ employeeId: fin28Id, date, shiftId: huit.id })),
    // Après la fin du 28/09 : un créneau SYSTÈME seul (Repos) ne prouve aucun travail.
    { employeeId: repos29Id, date: d("2026-09-29"), shiftId: repos.id },
  ] });
  // Après la fin du 28/09 : une présence P sans créneau, ou des heures faites sans rien d'autre.
  await prisma.attendance.create({ data: { employeeId: presence29Id, date: d("2026-09-29"), code: "P" } });
  await prisma.overtimeEntry.create({ data: { employeeId: heures29Id, date: d("2026-09-29"), heuresTravaillees: 8 } });

  // Congés : lien au type par le NOM. Sans solde = tauxPct 0 exactement ; « Autre » à valider = null.
  await prisma.typeConge.createMany({ data: [
    { nom: "Congé sans solde", tauxPct: 0 },
    { nom: "Congé annuel", tauxPct: 100 },
    { nom: "Autre", tauxPct: null },
  ] });
  const demande = (employeeId: string, type: string, debut: string, finIso: string, statut: "APPROUVE" | "EN_ATTENTE" | "REFUSE" = "APPROUVE") =>
    ({ employeeId, type, dateDebut: d(debut), dateFin: d(finIso), nbJours: 1, statut });
  await prisma.leaveRequest.createMany({ data: [
    demande(congesId, "Congé sans solde", "2026-09-14", "2026-09-19"), // couvre le férié (fictif) du 16
    demande(congesId, "Congé annuel", "2026-09-21", "2026-09-22"),
    demande(congesId, "Congé sans solde", "2026-09-23", "2026-09-23", "EN_ATTENTE"),
    demande(congesId, "Congé sans solde", "2026-09-24", "2026-09-24", "REFUSE"),
    demande(congesId, "Autre", "2026-09-25", "2026-09-25"),
    demande(congesId, "Type Disparu", "2026-09-26", "2026-09-26"),
    demande(congesId, "Congé sans solde", "2026-08-30", "2026-09-02"), // à cheval sur août
    demande(ssFerieId, "Congé sans solde", "2026-09-14", "2026-09-19"),
    demande(chevalId, "Congé sans solde", "2026-09-30", "2026-10-03"), // à cheval sur octobre
    demande(chevalId, "Congé sans solde", "2026-10-06", "2026-10-06"), // hors de la plage de septembre
  ] });
  // Semaines à cheval de septembre (lun 31/08 → dim 06/09, lun 28/09 → dim 04/10) : des données HORS
  // du mois, et d'autres juste après la plage (lundi 05/10) qui ne doivent pas être lues.
  await prisma.planningCreneau.createMany({ data: [
    { employeeId: chevalId, date: d("2026-08-31"), shiftId: huit.id },
    { employeeId: chevalId, date: d("2026-08-30"), shiftId: huit.id }, // dimanche d'avant : hors plage
    { employeeId: chevalId, date: d("2026-10-02"), shiftId: huit.id },
    { employeeId: chevalId, date: d("2026-10-05"), shiftId: huit.id }, // lundi d'après : hors plage
  ] });
  await prisma.attendance.createMany({ data: [
    { employeeId: chevalId, date: d("2026-08-31"), code: "P" },
    { employeeId: chevalId, date: d("2026-10-01"), code: "S" },
  ] });
  await prisma.overtimeEntry.create({ data: { employeeId: chevalId, date: d("2026-08-31"), heuresTravaillees: 8 } });
  await prisma.jourFerie.createMany({ data: [
    { date: d("2026-08-30"), designation: "Férié fictif hors plage", annee: 2026 },
    { date: d("2026-10-03"), designation: "Férié fictif à cheval", annee: 2026 },
    { date: d("2026-10-05"), designation: "Férié fictif hors plage", annee: 2026 },
  ] });
  // Bout en bout : planning complet sauf la semaine du congé sans solde, dont les jours ouvrables
  // portent S (posé par `poserCodesConge`, qui saute le férié du 16 : il arrive SANS code).
  await prisma.planningCreneau.createMany({ data: lunSam.filter((date) => date.getUTCDate() < 14 || date.getUTCDate() > 19).map((date) => ({ employeeId: ssFerieId, date, shiftId: huit.id })) });
  await prisma.attendance.createMany({ data: ["14", "15", "17", "18", "19"].map((n) => ({ employeeId: ssFerieId, date: d(`2026-09-${n}`), code: "S" })) });
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
    { ...contrat, employeeId: echu01Id, type: "CDD", dateDebut: d("2026-03-01"), dateFin: d("2026-09-01") },
    ...[repos29Id, presence29Id, heures29Id].map((employeeId) => ({ ...contrat, employeeId, type: "CDD" as const, dateDebut: d("2026-03-01"), dateFin: d("2026-09-28") })),
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
      dateEmbauche: d("2025-01-06"), dateFinContrat: m.get(id)!.dateFinContrat, joursFeries: new Set(), joursCongePris: 0, joursCongeSansSolde: m.get(id)!.joursCongeSansSolde, joursHorsMois: m.get(id)!.joursHorsMois,
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

describe("chargerJoursMois — CDD échu mais poursuivi (décision du contrôleur)", () => {
  it("fin le 01/09 puis créneaux de travail : fin ignorée, cddEchuLe = 01/09", async () => {
    const e = (await chargerJoursMois(9, 2026, [echu01Id])).get(echu01Id)!;
    expect(e.dateFinContrat).toBeNull();
    expect(e.cddEchuLe?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("fin le 28/09 sans rien après (créneau le 28 lui-même) : inchangé", async () => {
    const e = (await chargerJoursMois(9, 2026, [fin28Id])).get(fin28Id)!;
    expect(e.dateFinContrat?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(e.cddEchuLe).toBeNull();
  });

  it("fin le 28/09 et seulement un créneau SYSTÈME (Repos) après : inchangé", async () => {
    const e = (await chargerJoursMois(9, 2026, [repos29Id])).get(repos29Id)!;
    expect(e.dateFinContrat?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(e.cddEchuLe).toBeNull();
  });

  it("fin le 28/09 et une présence P le 29 sans créneau, ou des heures le 29 : fin ignorée", async () => {
    const m = await chargerJoursMois(9, 2026, [presence29Id, heures29Id]);
    for (const id of [presence29Id, heures29Id]) {
      expect(m.get(id)!.dateFinContrat).toBeNull();
      expect(m.get(id)!.cddEchuLe?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    }
  });

  it("bout en bout : le CDD échu le 01/09 et poursuivi est payé sur son planning, sans motif de fin", async () => {
    const params = await chargerParametresPaie();
    const e = (await chargerJoursMois(9, 2026, [echu01Id])).get(echu01Id)!;
    const r = calculerReferenceMois({
      annee: 2026, mois: 9, jours: e.jours, salaireMensuel: 300, heuresHebdomadaires: 48, heuresParJour: 8,
      dateEmbauche: d("2025-01-06"), dateFinContrat: e.dateFinContrat, joursFeries: new Set(), joursCongePris: 0, joursCongeSansSolde: e.joursCongeSansSolde, joursHorsMois: e.joursHorsMois,
      referencePlanningDepuis: params.referencePlanningDepuis ?? null, params,
    });
    expect(r.source).toBe("PLANNING");
    expect(r.motif).toBeNull();
  });
});

describe("chargerJoursMois — jours de congé sans solde approuvé", () => {
  it("seul un congé APPROUVÉ à tauxPct 0 compte, tous jours civils du mois, férié compris", async () => {
    const liste = (await chargerJoursMois(9, 2026, [congesId])).get(congesId)!.joursCongeSansSolde;
    expect(liste).toEqual([
      "2026-08-31", "2026-09-01", "2026-09-02", // congé à cheval sur août : 31/08 est dans la semaine du 1er
      "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19",
    ]);
    // Rien pour : congé annuel (21-22), EN_ATTENTE (23), REFUSÉE (24), « Autre » à tauxPct null (25),
    // type introuvable (26).
    expect((await chargerJoursMois(9, 2026, [sansId])).get(sansId)!.joursCongeSansSolde).toEqual([]);
  });

  it("le même congé à cheval, lu en août : août (dimanche 30 compris) + la fin de la semaine du 31/08", async () => {
    // Plage d'août : lun 27/07 → dim 06/09.
    expect((await chargerJoursMois(8, 2026, [congesId])).get(congesId)!.joursCongeSansSolde).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("bout en bout : un férié pris dans un congé sans solde n'est pas payé ; sans la liste, il le serait", async () => {
    const params = await chargerParametresPaie();
    const e = (await chargerJoursMois(9, 2026, [ssFerieId])).get(ssFerieId)!;
    expect(e.joursCongeSansSolde).toContain("2026-09-16");
    const reference = (joursCongeSansSolde: string[]) => calculerReferenceMois({
      annee: 2026, mois: 9, jours: e.jours, salaireMensuel: 300, heuresHebdomadaires: 48, heuresParJour: 8,
      dateEmbauche: d("2025-01-06"), dateFinContrat: e.dateFinContrat, joursFeries: new Set(["2026-09-16"]), joursCongePris: 0, joursCongeSansSolde, joursHorsMois: e.joursHorsMois,
      referencePlanningDepuis: params.referencePlanningDepuis ?? null, params,
    });
    const avec = reference(e.joursCongeSansSolde);
    expect(avec.source).toBe("PLANNING");
    expect(avec.affichage.heuresPayeesNonTravaillees).toBe(0);
    // Témoin : sans la liste, le férié du 16 serait payé au forfait (8 h).
    expect(reference([]).affichage.heuresPayeesNonTravaillees).toBe(8);
  });
});

describe("chargerJoursMois — semaines à cheval : lecture élargie au lundi → dimanche", () => {
  it("jours hors du mois, fériés et congés sans solde de la plage, rien au-delà", async () => {
    const e = (await chargerJoursMois(9, 2026, [chevalId])).get(chevalId)!;
    expect(e.jours).toHaveLength(30); // le mois, et lui seul
    expect(e.saisie).toHaveLength(30);
    expect(e.joursHorsMois.map((j) => j.date.toISOString().slice(0, 10))).toEqual(["2026-08-31", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    const hors = (iso: string) => e.joursHorsMois.find((j) => j.date.toISOString().slice(0, 10) === iso)!;
    expect(hors("2026-08-31")).toMatchObject({ heuresPlanifiees: 8, aUnCreneau: true, code: "P", heuresFaites: 8 });
    expect(hors("2026-10-01")).toMatchObject({ heuresPlanifiees: 0, aUnCreneau: false, code: "S" });
    expect(hors("2026-10-02")).toMatchObject({ heuresPlanifiees: 8, aUnCreneau: true, code: null });
    expect([...e.joursFeries].sort()).toEqual(["2026-10-03"]);
    expect(e.joursCongeSansSolde).toEqual(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });
});
