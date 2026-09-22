import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { empreinteDe, instantaneBulletin } from "@/lib/signature-document";

// Vérifie la lecture/écriture d'une signature électronique : signabilité du document,
// écriture (upsert borné à une signature non obsolète), et détection d'un document modifié
// après signature (obsolescence PERSISTÉE, pas seulement renvoyée).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { documentSignable, enregistrerSignature, chargerSignature } = await import("@/lib/signature");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let presentateurId: string;
let ligneValideId: string;
let ligneBrouillonId: string;
let demandeApprouveeId: string;
let demandeEnAttenteId: string;
let contratActifId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  const emp = await prisma.employee.create({
    data: {
      matricule: "TS01-PEF", nom: "Test Signature", sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;

  const presentateur = await prisma.user.create({
    data: { email: "presentateur.signature@test.pef", nom: "Présentateur Test", role: "ADMIN" },
  });
  presentateurId = presentateur.id;

  const run = await prisma.payrollRun.create({
    data: { mois: 8, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 },
  });

  const ligneBase = {
    payrollRunId: run.id, employeeId: empId,
    transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
    iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000,
    cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
  };
  const ligneValide = await prisma.payrollLine.create({
    data: { ...ligneBase, statutPaiement: "VALIDE" },
  });
  ligneValideId = ligneValide.id;

  const ligneBrouillon = await prisma.payrollLine.create({
    data: {
      ...ligneBase, statutPaiement: "PAS_VALIDE",
      payrollRunId: (await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, statut: "BROUILLON", tauxChangeUtilise: 2800 } })).id,
    },
  });
  ligneBrouillonId = ligneBrouillon.id;

  const demandeApprouvee = await prisma.leaveRequest.create({
    data: {
      employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-08-03"),
      dateFin: new Date("2026-08-07"), nbJours: 5, statut: "APPROUVE",
    },
  });
  demandeApprouveeId = demandeApprouvee.id;

  const demandeEnAttente = await prisma.leaveRequest.create({
    data: {
      employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-09-03"),
      dateFin: new Date("2026-09-05"), nbJours: 3, statut: "EN_ATTENTE",
    },
  });
  demandeEnAttenteId = demandeEnAttente.id;

  const contratActif = await prisma.contrat.create({
    data: {
      employeeId: empId, type: "CDI", dateDebut: new Date("2025-01-01"),
      heuresHebdo: 48, salaireMensuel: 300, devise: "USD", poste: "Test", statut: "ACTIF",
    },
  });
  contratActifId = contratActif.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("documentSignable — état du document", () => {
  it("un bulletin VALIDÉ est signable", async () => {
    const etat = await documentSignable(prisma, "BULLETIN", ligneValideId);
    expect(etat.ok).toBe(true);
    if (etat.ok) expect(etat.employeeId).toBe(empId);
  });

  it("un bulletin en BROUILLON ne l'est pas", async () => {
    const etat = await documentSignable(prisma, "BULLETIN", ligneBrouillonId);
    expect(etat.ok).toBe(false);
    if (!etat.ok) expect(etat.raison).toContain("validé");
  });

  it("une demande EN_ATTENTE ne l'est pas", async () => {
    const etat = await documentSignable(prisma, "DEMANDE_CONGE", demandeEnAttenteId);
    expect(etat.ok).toBe(false);
    if (!etat.ok) expect(etat.raison).toContain("approuvée");
  });

  it("une demande APPROUVÉE l'est", async () => {
    const etat = await documentSignable(prisma, "DEMANDE_CONGE", demandeApprouveeId);
    expect(etat.ok).toBe(true);
    if (etat.ok) expect(etat.employeeId).toBe(empId);
  });
});

describe("enregistrerSignature — écriture d'une signature", () => {
  it("écrit le tracé, le mode et l'empreinte", async () => {
    await enregistrerSignature(prisma, {
      cible: "BULLETIN", cibleId: ligneValideId, employeeId: empId,
      traceUrl: "https://storage.test/signatures/BULLETIN/trace.png",
      mode: "PRESENTIEL", presenteParId: presentateurId,
    });

    const ligne = await prisma.payrollLine.findUniqueOrThrow({
      where: { id: ligneValideId },
      include: { payrollRun: true, employee: { select: { matricule: true } } },
    });
    const empreinteAttendue = empreinteDe(instantaneBulletin(ligne));

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(sig).not.toBeNull();
    expect(sig?.traceUrl).toBe("https://storage.test/signatures/BULLETIN/trace.png");
    expect(sig?.mode).toBe("PRESENTIEL");
    expect(sig?.empreinte).toBe(empreinteAttendue);
  });

  it("signer deux fois le même document est refusé", async () => {
    await expect(
      enregistrerSignature(prisma, {
        cible: "BULLETIN", cibleId: ligneValideId, employeeId: empId,
        traceUrl: "https://storage.test/signatures/BULLETIN/re-trace.png",
        mode: "PRESENTIEL", presenteParId: presentateurId,
      })
    ).rejects.toThrow();
  });
});

describe("chargerSignature — obsolescence quand le document change", () => {
  it("marque obsolète quand un montant a changé, et le PERSISTE en base", async () => {
    await prisma.payrollLine.update({
      where: { id: ligneValideId },
      data: { salNetUSD: 291 },
    });

    const vue = await chargerSignature(prisma, "BULLETIN", ligneValideId);
    expect(vue?.obsolete).toBe(true);

    // Vérifie la persistance EN BASE, pas seulement la valeur renvoyée par l'appel précédent.
    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(sig?.obsolete).toBe(true);
  });

  it("une signature reprise (empreinte vide) n'est jamais marquée obsolète", async () => {
    await prisma.signatureElectronique.create({
      data: {
        cible: "CONTRAT", cibleId: contratActifId, employeeId: empId,
        traceUrl: null, mode: "PRESENTIEL", donnees: {}, empreinte: "", obsolete: false,
      },
    });

    const vue = await chargerSignature(prisma, "CONTRAT", contratActifId);
    expect(vue?.obsolete).toBe(false);

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "CONTRAT", cibleId: contratActifId } },
    });
    expect(sig?.obsolete).toBe(false);
  });
});

describe("enregistrerSignature — l'invariant « déjà signé » est tenu par la base", () => {
  it("une signature marquée obsolète reste remplaçable", async () => {
    // Précondition posée par le test précédent : la signature du bulletin est obsolète.
    const avant = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(avant?.obsolete).toBe(true);

    await enregistrerSignature(prisma, {
      cible: "BULLETIN", cibleId: ligneValideId, employeeId: empId,
      traceUrl: "https://storage.test/signatures/BULLETIN/re-signee.png",
      mode: "PRESENTIEL", presenteParId: presentateurId,
    });

    const apres = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(apres?.obsolete).toBe(false);
    expect(apres?.traceUrl).toBe("https://storage.test/signatures/BULLETIN/re-signee.png");
  });

  it("deux enregistrements CONCURRENTS sur un document neuf : un seul réussit, l'autre est refusé", async () => {
    const urlA = "https://storage.test/signatures/DEMANDE_CONGE/concurrent-a.png";
    const urlB = "https://storage.test/signatures/DEMANDE_CONGE/concurrent-b.png";

    const [resA, resB] = await Promise.allSettled([
      enregistrerSignature(prisma, {
        cible: "DEMANDE_CONGE", cibleId: demandeApprouveeId, employeeId: empId,
        traceUrl: urlA, mode: "ESPACE_SALARIE", presenteParId: null,
      }),
      enregistrerSignature(prisma, {
        cible: "DEMANDE_CONGE", cibleId: demandeApprouveeId, employeeId: empId,
        traceUrl: urlB, mode: "ESPACE_SALARIE", presenteParId: null,
      }),
    ]);

    const resultats = [
      { res: resA, url: urlA },
      { res: resB, url: urlB },
    ];
    const gagnants = resultats.filter((r) => r.res.status === "fulfilled");
    const perdants = resultats.filter((r) => r.res.status === "rejected");
    expect(gagnants).toHaveLength(1);
    expect(perdants).toHaveLength(1);

    const perdant = perdants[0].res;
    if (perdant.status === "rejected") {
      expect((perdant.reason as Error).message).toBe("Ce document est déjà signé.");
    }

    // Une seule ligne en base, portant le tracé du gagnant — l'invariant est tenu par la
    // contrainte d'unicité de la base, pas par la lecture applicative qui a pu être périmée.
    const lignes = await prisma.signatureElectronique.findMany({
      where: { cible: "DEMANDE_CONGE", cibleId: demandeApprouveeId },
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].traceUrl).toBe(gagnants[0].url);
  }, 30_000);
});
