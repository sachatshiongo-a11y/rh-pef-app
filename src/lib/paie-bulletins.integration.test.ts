import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// LE MÊME BULLETIN DIT LA MÊME CHOSE, À L'UNITÉ ET DANS LA LIASSE.
//
// Les exports groupés (PDF du mois, ZIP de PDF séparés) ne chargeaient pas la signature : la
// Direction imprimait la liasse et distribuait des bulletins qui paraissent NON SIGNÉS alors
// qu'ils le sont — l'inverse exact de ce que la signature électronique promet.
//
// Ce test compare les deux chemins sur le MÊME bulletin :
//  - unitaire : `signatureImprimable` (ce que charge `bulletin-buffer.ts`, route /paie/bulletin
//    et route /espace/bulletin) ;
//  - groupé : `bulletinsPourPdf`, l'assembleur que les DEUX routes d'export utilisent.
// Les deux alimentent le même `BulletinPage` (dont le rendu est déjà prouvé par
// `pdf/signature.render.test.ts`) : des propriétés identiques donnent donc un document identique.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

// Le tracé vit dans le bucket privé : on rend un contenu reconnaissable, jamais un vrai appel.
const TRACE = Buffer.from("trace-de-test-du-salarie");
vi.mock("@/lib/storage", () => ({
  lireFichier: async () => TRACE,
  televerserFichier: async (chemin: string) => `/fichiers/${chemin}`,
}));

const { chargerDonneesBulletinsDuMois, bulletinsPourPdf } = await import("@/lib/paie-bulletins");
const { enregistrerSignature, signatureImprimable } = await import("@/lib/signature");

const MOIS = 7;
const ANNEE = 2026;

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let ligneId: string;
let empId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, ANNEE);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: ANNEE, moisCourant: MOIS } });

  const emp = await prisma.employee.create({
    data: {
      matricule: "LI01-PEF", nom: "Aimée Liasse", sexe: "F", etatCivil: "Célibataire",
      poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;

  const run = await prisma.payrollRun.create({
    data: { mois: MOIS, annee: ANNEE, statut: "VALIDE", tauxChangeUtilise: 2800 },
  });
  const ligne = await prisma.payrollLine.create({
    data: {
      payrollRunId: run.id, employeeId: empId, statutPaiement: "VALIDE",
      transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
      iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000,
      cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
    },
  });
  ligneId = ligne.id;

  await enregistrerSignature(prisma, {
    cible: "BULLETIN",
    cibleId: ligneId,
    employeeId: empId,
    traceUrl: `/fichiers/signatures/bulletin/${ligneId}.png`,
    mode: "ESPACE_SALARIE",
    presenteParId: null,
  });
}, 120_000);

afterAll(async () => { await fermer?.(); });

/** Le bulletin de notre salariée, tel que l'export groupé le remet au générateur de PDF. */
async function versionGroupee() {
  const donnees = await chargerDonneesBulletinsDuMois(MOIS, ANNEE);
  expect(donnees).not.toBeNull();
  const b = bulletinsPourPdf(donnees!).find((x) => x.ligne.id === ligneId);
  expect(b, "le bulletin signé doit être dans la liasse du mois").toBeDefined();
  return b!;
}

describe("exports groupés de bulletins — la liasse ne se tait pas sur une signature", () => {
  it("porte la MÊME mention que le bulletin ouvert à l'unité", async () => {
    const unitaire = await signatureImprimable(prisma, "BULLETIN", ligneId);
    const groupee = await versionGroupee();

    expect(unitaire?.mention).toContain("Signé électroniquement par Aimée Liasse (matricule LI01-PEF)");
    expect(groupee.signatureSalarie, "l'export groupé doit charger la signature").toBeDefined();
    expect(groupee.signatureSalarie!.mention).toBe(unitaire!.mention);
  });

  it("porte le MÊME tracé que le bulletin ouvert à l'unité", async () => {
    const unitaire = await signatureImprimable(prisma, "BULLETIN", ligneId);
    const groupee = await versionGroupee();

    expect(unitaire?.image?.data).toEqual(TRACE);
    expect(groupee.signatureSalarie!.image).toEqual(unitaire!.image);
  });

  it("un bulletin jamais signé ne reçoit aucune mention, des deux côtés", async () => {
    const autre = await prisma.employee.create({
      data: {
        matricule: "LI02-PEF", nom: "Non Signataire", sexe: "M", etatCivil: "Célibataire",
        poste: "Serveur", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 200,
        dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
      },
    });
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { mois_annee: { mois: MOIS, annee: ANNEE } } });
    const ligne = await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId: autre.id, statutPaiement: "VALIDE",
        transportUSD: 10, salBrutUSD: 200, cnssSalarieUSD: 10, netImposableUSD: 190,
        iprCalculeUSD: 5, allocFamilialeUSD: 0, salNetUSD: 195, salNetCDF: 546000,
        cnssPatronalUSD: 24, coutEmployeurUSD: 224, coutEmployeurCDF: 627200,
      },
    });

    expect(await signatureImprimable(prisma, "BULLETIN", ligne.id)).toBeUndefined();
    const donnees = await chargerDonneesBulletinsDuMois(MOIS, ANNEE);
    const b = bulletinsPourPdf(donnees!).find((x) => x.ligne.id === ligne.id);
    expect(b!.signatureSalarie).toBeUndefined();
  });

  // ⚠️ DERNIER : il modifie la paie de la salariée signataire.
  it("après un recalcul, les deux chemins disent « modifié après signature » et perdent le tracé", async () => {
    await prisma.payrollLine.update({ where: { id: ligneId }, data: { salNetUSD: 291 } });

    const unitaire = await signatureImprimable(prisma, "BULLETIN", ligneId);
    const groupee = await versionGroupee();

    expect(unitaire!.mention).toContain("Document modifié après signature");
    expect(unitaire!.image).toBeNull();
    expect(groupee.signatureSalarie!.mention).toBe(unitaire!.mention);
    expect(groupee.signatureSalarie!.image).toBeNull();
  });
});

describe("les deux routes d'export groupé passent par le même assembleur", () => {
  // Recopié dans chaque route, l'oubli de `signatureSalarie` dans UNE seule des deux resterait
  // invisible : ce garde-fou refuse qu'une route réassemble les bulletins pour son compte.
  const routes = [
    "src/app/(app)/paie/bulletins-pdf/route.ts",
    "src/app/(app)/paie/bulletins-zip/route.ts",
  ];
  for (const route of routes) {
    it(`${route} appelle bulletinsPourPdf`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), route), "utf8");
      expect(source).toContain("bulletinsPourPdf(donnees)");
    });
  }
});
