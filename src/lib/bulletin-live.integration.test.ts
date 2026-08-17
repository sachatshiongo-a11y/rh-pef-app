import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Test d'INTÉGRATION — #2 (régression) : `calculerBulletinLive` (aperçu de la fiche employé) doit
// respecter le régime de contrat comme le VRAI moteur (`calculerLignesPaie`, paie-batch.ts) : un
// STAGE n'a ni CNSS/IPR/INPP/ONEM ni heures supp. valorisées ; un INTÉRIMAIRE n'a AUCUN bulletin
// (payé par l'agence). Avant le correctif du 2026-07-22, seule la catégorie BRIGADE/BACKOFFICE était
// testée : un stagiaire recevait un faux bulletin avec des cotisations jamais prélevées, et un
// intérimaire un bulletin fictif. On verrouille aussi la NON-DIVERGENCE avec le vrai moteur sur un
// cas BRIGADE ordinaire : c'est l'écart entre ces deux fichiers qui avait laissé passer le bug.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { calculerBulletinLive } = await import("./bulletin-live");
const { calculerLignesPaie } = await import("./paie-batch");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let stageId: string;
let interimFicheId: string; // INTERIM porté par la fiche employé (pas de Contrat)
let interimContratId: string; // fiche "CDD" mais un Contrat ACTIF de type INTERIM prime dessus
let brigadeId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 7 } });

  // STAGE : heuresHebdomadaires réduites (40h) pour déclencher une VRAIE HS sous-jacente sur une
  // semaine à 50h, afin de vérifier qu'elle est bien FORCÉE à 0 par le régime stage (pas juste
  // absente faute de données).
  const stage = await prisma.employee.create({
    data: {
      matricule: "BS01-PEF", nom: "Stagiaire Test", sexe: "F", etatCivil: "Célibataire",
      poste: "Stagiaire RH", secteur: "Administration", categorie: "BACKOFFICE",
      salaireMensuel: 150, transportMoisUSD: 10, heuresParJour: 8, heuresHebdomadaires: 40,
      dateEmbauche: new Date("2026-06-01"), contrat: "STAGE", enfants: 2,
    },
  });
  stageId = stage.id;
  const joursStage = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]; // 5×10h = 50h/sem
  await prisma.attendance.createMany({ data: joursStage.map((d) => ({ employeeId: stageId, date: new Date(d), code: "P" as const })) });
  await prisma.overtimeEntry.createMany({ data: joursStage.map((d) => ({ employeeId: stageId, date: new Date(d), heuresTravaillees: 10 })) });

  // INTÉRIM porté directement par la fiche (aucun Contrat en base).
  const interimFiche = await prisma.employee.create({
    data: {
      matricule: "BI01-PEF", nom: "Intérim Fiche Test", sexe: "M", etatCivil: "Célibataire",
      poste: "Manutentionnaire", secteur: "Logistique", categorie: "BRIGADE",
      salaireMensuel: 200, dateEmbauche: new Date("2026-06-01"), contrat: "INTERIM",
    },
  });
  interimFicheId = interimFiche.id;

  // INTÉRIM porté par un Contrat ACTIF, alors que la fiche affiche encore "CDD" — le Contrat
  // ACTIF doit primer (même règle que paie-batch.ts : typeContratParEmp).
  const interimContrat = await prisma.employee.create({
    data: {
      matricule: "BI02-PEF", nom: "Intérim Contrat Test", sexe: "M", etatCivil: "Célibataire",
      poste: "Manutentionnaire", secteur: "Logistique", categorie: "BRIGADE",
      salaireMensuel: 200, dateEmbauche: new Date("2026-06-01"), contrat: "CDD",
    },
  });
  interimContratId = interimContrat.id;
  await prisma.contrat.create({
    data: {
      employeeId: interimContratId, type: "INTERIM", dateDebut: new Date("2026-06-01"),
      heuresHebdo: 48, salaireMensuel: 200, poste: "Manutentionnaire", statut: "ACTIF",
      agence: "Agence Test",
    },
  });

  // BRIGADE ordinaire : même profil que paie-batch.integration.test.ts, pour comparer les deux
  // moteurs sur un cas non trivial (heures, transport, prime, acompte).
  const brigade = await prisma.employee.create({
    data: {
      matricule: "BB01-PEF", nom: "Brigade Comparaison", sexe: "M", etatCivil: "Célibataire",
      poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 260, heuresParJour: 8, heuresHebdomadaires: 48, transportJourCDF: 2300,
      dateEmbauche: new Date("2024-01-01"), contrat: "CDI", enfants: 1,
    },
  });
  brigadeId = brigade.id;
  const joursP = [
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  ];
  await prisma.attendance.createMany({ data: joursP.map((d) => ({ employeeId: brigadeId, date: new Date(d), code: "P" as const })) });
  await prisma.overtimeEntry.createMany({ data: joursP.map((d) => ({ employeeId: brigadeId, date: new Date(d), heuresTravaillees: 8 })) });
  await prisma.attendance.createMany({ data: ["2026-07-11", "2026-07-18"].map((d) => ({ employeeId: brigadeId, date: new Date(d), code: "O" as const })) });
  await prisma.prime.create({ data: { employeeId: brigadeId, nom: "Prime rendement", montantUSD: 15, mois: 7, annee: 2026 } });
  await prisma.acompteSalaire.create({ data: { employeeId: brigadeId, montantUSD: 20, mois: 7, annee: 2026, statut: "APPROUVE" } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("calculerBulletinLive — régime STAGE (#2, régression)", () => {
  it("aucune cotisation/impôt (CNSS/IPR/INPP/ONEM), aucune allocation familiale, HS forcée à 0", async () => {
    const b = await calculerBulletinLive(stageId, 7, 2026);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.ligne.cnssSalarieUSD).toBe(0);
    expect(b.ligne.cnssPatronalUSD).toBe(0);
    expect(b.ligne.inppUSD).toBe(0);
    expect(b.ligne.onemUSD).toBe(0);
    expect(b.ligne.iprCalculeUSD).toBe(0);
    expect(b.ligne.allocFamilialeUSD).toBe(0); // 2 enfants sur la fiche, ignorés en stage
    // HS forcée à 0 bien qu'une semaine à 50h (> 40h contrat) génère une VRAIE HS sous-jacente.
    expect(b.hs30).toBe(0);
    expect(b.hs60).toBe(0);
    expect(b.hs100).toBe(0);
    // Indemnité forfaitaire = salaireMensuel + transport, versée intégralement au net.
    expect(b.ligne.salBrutUSD).toBeCloseTo(150 + 10, 6);
    expect(b.ligne.salNetUSD).toBeCloseTo(150 + 10, 6);
  });
});

describe("calculerBulletinLive — régime INTÉRIM (#2, régression)", () => {
  it("aucun bulletin quand l'INTÉRIM est porté par la fiche employé", async () => {
    expect(await calculerBulletinLive(interimFicheId, 7, 2026)).toBeNull();
  });

  it("aucun bulletin quand l'INTÉRIM est porté par un Contrat ACTIF (prime sur la fiche 'CDD')", async () => {
    expect(await calculerBulletinLive(interimContratId, 7, 2026)).toBeNull();
  });
});

describe("calculerBulletinLive vs calculerLignesPaie — non-divergence des deux moteurs (#2)", () => {
  it("même employé, même mois : net/cotisations/IPR identiques entre l'aperçu live et le vrai moteur batch", async () => {
    const live = await calculerBulletinLive(brigadeId, 7, 2026);
    const { lignes } = await calculerLignesPaie(7, 2026);
    const batch = lignes.find((l) => l.employee.id === brigadeId);
    expect(live).not.toBeNull();
    expect(batch).toBeTruthy();
    if (!live || !batch) return;

    expect(live.ligne.salBrutUSD).toBeCloseTo(batch.data.salBrutUSD, 6);
    expect(live.ligne.cnssSalarieUSD).toBeCloseTo(batch.data.cnssSalarieUSD, 6);
    expect(live.ligne.iprCalculeUSD).toBeCloseTo(batch.data.iprCalculeUSD, 6);
    expect(live.ligne.salNetUSD).toBeCloseTo(batch.data.salNetUSD, 6);
    expect(live.ligne.cnssPatronalUSD).toBeCloseTo(batch.data.cnssPatronalUSD, 6);
    expect(live.hs30).toBeCloseTo(batch.data.heuresSupp30, 6);
    expect(live.hs60).toBeCloseTo(batch.data.heuresSupp60, 6);
    expect(live.primesUSD).toBeCloseTo(batch.data.primesUSD, 6);
    expect(live.acompteUSD).toBeCloseTo(batch.data.acompteUSD, 6);
  });
});
