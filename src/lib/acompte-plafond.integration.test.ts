import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { chargerPlafondAcompte } from "./acompte-plafond";

// Test d'INTÉGRATION : la règle du plafond est pure et testée à part (acompte-plafond.test.ts) ;
// ce fichier vérifie ce que la fonction pure ne peut pas voir — que les BONNES données lui sont
// servies : le net du bon mois (y compris à la bascule d'année), les bons statuts d'acompte, et
// l'exclusion de l'acompte qu'on est en train d'approuver.
//
// `chargerPlafondAcompte` reçoit son client Prisma en paramètre : pas besoin de mocker
// « @/lib/prisma », on lui passe directement la base de test.

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let empSansBulletinId: string;

const baseEmp = {
  sexe: "M", etatCivil: "Célibataire", poste: "Test", secteur: "Cuisine",
  categorie: "BRIGADE" as const, dateEmbauche: new Date("2024-01-01"), contrat: "CDI" as const,
};

/** PayrollLine minimale : seul `salNetUSD` compte ici, le reste satisfait le schéma. */
async function creerBulletin(employeeId: string, mois: number, annee: number, netUSD: number) {
  const run = await prisma.payrollRun.upsert({
    where: { mois_annee: { mois, annee } },
    create: { mois, annee, tauxChangeUtilise: 2800 },
    update: {},
  });
  await prisma.payrollLine.create({
    data: {
      payrollRunId: run.id, employeeId,
      salBrutUSD: netUSD, cnssSalarieUSD: 0, netImposableUSD: netUSD, iprCalculeUSD: 0,
      allocFamilialeUSD: 0, salNetUSD: netUSD, salNetCDF: netUSD * 2800,
      cnssPatronalUSD: 0, coutEmployeurUSD: netUSD, coutEmployeurCDF: netUSD * 2800,
    },
  });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;

  const e1 = await prisma.employee.create({
    data: { ...baseEmp, matricule: "AC01-PEF", nom: "Avec Bulletin", salaireMensuel: 400 },
  });
  empId = e1.id;
  const e2 = await prisma.employee.create({
    data: { ...baseEmp, matricule: "AC02-PEF", nom: "Embauche Recente", salaireMensuel: 250 },
  });
  empSansBulletinId = e2.id;

  // Net de juillet 2026 = 310 $ → référence pour un acompte demandé en août 2026.
  await creerBulletin(empId, 7, 2026, 310);
  // Net de décembre 2025 = 290 $ → référence pour un acompte demandé en janvier 2026.
  await creerBulletin(empId, 12, 2025, 290);
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("chargerPlafondAcompte — quelle référence est servie", () => {
  it("lit le net du mois précédent quand un bulletin existe", async () => {
    const p = await chargerPlafondAcompte(prisma, { employeeId: empId, mois: 8, annee: 2026 });
    expect(p.source).toBe("NET_MOIS_PRECEDENT");
    expect(p.plafondUSD).toBe(310);
  });

  it("remonte à décembre de l'année précédente pour un acompte de janvier", async () => {
    // La bascule d'année est le cas où un décalage de mois passe inaperçu : sans elle, janvier
    // ne trouverait aucun bulletin et retomberait à tort sur le salaire de la fiche.
    const p = await chargerPlafondAcompte(prisma, { employeeId: empId, mois: 1, annee: 2026 });
    expect(p.source).toBe("NET_MOIS_PRECEDENT");
    expect(p.plafondUSD).toBe(290);
  });

  it("retombe sur le salaire de la fiche pour une embauche sans bulletin", async () => {
    const p = await chargerPlafondAcompte(prisma, { employeeId: empSansBulletinId, mois: 8, annee: 2026 });
    expect(p.source).toBe("SALAIRE_FICHE");
    expect(p.plafondUSD).toBe(250);
  });
});

describe("chargerPlafondAcompte — quels acomptes comptent dans le cumul", () => {
  it("compte les acomptes EN_ATTENTE et APPROUVÉS du mois, ignore les REFUSÉS et les autres mois", async () => {
    const emp = await prisma.employee.create({
      data: { ...baseEmp, matricule: "AC03-PEF", nom: "Cumul", salaireMensuel: 400 },
    });
    await creerBulletin(emp.id, 7, 2026, 300);
    await prisma.acompteSalaire.createMany({
      data: [
        { employeeId: emp.id, montantUSD: 100, mois: 8, annee: 2026, statut: "EN_ATTENTE" },
        { employeeId: emp.id, montantUSD: 50, mois: 8, annee: 2026, statut: "APPROUVE" },
        { employeeId: emp.id, montantUSD: 90, mois: 8, annee: 2026, statut: "REFUSE" },
        { employeeId: emp.id, montantUSD: 70, mois: 9, annee: 2026, statut: "APPROUVE" },
      ],
    });

    const p = await chargerPlafondAcompte(prisma, { employeeId: emp.id, mois: 8, annee: 2026 });
    expect(p.dejaEngageUSD).toBe(150); // 100 + 50, sans le refusé ni celui de septembre
    expect(p.disponibleUSD).toBe(150);
  });

  it("exclut l'acompte examiné du cumul (ré-examen à l'approbation)", async () => {
    const emp = await prisma.employee.create({
      data: { ...baseEmp, matricule: "AC04-PEF", nom: "Exclusion", salaireMensuel: 400 },
    });
    await creerBulletin(emp.id, 7, 2026, 300);
    const enCours = await prisma.acompteSalaire.create({
      data: { employeeId: emp.id, montantUSD: 200, mois: 8, annee: 2026, statut: "EN_ATTENTE" },
    });

    // Sans exclusion, l'acompte se compterait lui-même et paraîtrait toujours hors plafond.
    const sansExclusion = await chargerPlafondAcompte(prisma, { employeeId: emp.id, mois: 8, annee: 2026 });
    expect(sansExclusion.dejaEngageUSD).toBe(200);

    const avecExclusion = await chargerPlafondAcompte(prisma, {
      employeeId: emp.id, mois: 8, annee: 2026, exclureAcompteId: enCours.id,
    });
    expect(avecExclusion.dejaEngageUSD).toBe(0);
    expect(avecExclusion.disponibleUSD).toBe(300);
  });

  it("ne mélange pas les salariés", async () => {
    const emp = await prisma.employee.create({
      data: { ...baseEmp, matricule: "AC05-PEF", nom: "Isolé", salaireMensuel: 400 },
    });
    await creerBulletin(emp.id, 7, 2026, 300);
    const p = await chargerPlafondAcompte(prisma, { employeeId: emp.id, mois: 8, annee: 2026 });
    expect(p.dejaEngageUSD).toBe(0);
  });
});
