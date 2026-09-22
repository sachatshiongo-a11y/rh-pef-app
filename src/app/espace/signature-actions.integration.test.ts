import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// LA GARDE CRITIQUE : `enregistrerSignature` fait confiance à `employeeId` — rien à ce niveau
// n'empêche d'attribuer un document à un autre salarié. C'est à `signerMonDocument` de fermer ce
// trou : `employeeId` ne vient JAMAIS du navigateur, et on compare le `employeeId` renvoyé par
// `documentSignable` (relu en base) à `user.employeeId` (le compte connecté) AVANT d'écrire quoi
// que ce soit. Le test « il ne peut pas signer le bulletin d'un collègue » prouve cette fermeture.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "EMPLOYE", nom: "Testeur", employeeId: "seed-emp" } }));
const S = vi.hoisted(() => ({ chemins: [] as string[] }));
// Actif par défaut (comme dans la quasi-totalité des tests existants) ; certains tests le
// désactivent ponctuellement pour prouver que l'interrupteur bloque bien un appel DIRECT à
// l'action, indépendamment du rendu de page.
const F = vi.hoisted(() => ({ espaceEmployeActif: true }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  estSalarie: (u: { employeeId?: string | null }) => !!u.employeeId,
  requireRole: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/storage", () => ({
  // On RETIENT le chemin : c'est lui qui prouve qu'une tentative refusée n'écrase rien.
  // L'URL renvoyée DÉRIVE du chemin (comme le vrai stockage) : sans cela, deux téléversements
  // vers le même chemin seraient indiscernables et le test ci-dessous ne prouverait rien.
  televerserFichier: async (chemin: string) => { S.chemins.push(chemin); return `/fichiers/${chemin}`; },
  lireFichier: async () => null,
}));
vi.mock("@/lib/espace-employe", () => ({
  espaceEmployeActif: async () => F.espaceEmployeActif,
  emailInterneMatricule: (m: string) => `${m.toLowerCase()}@salarie.local`,
  estMatricule: (s: string) => !s.includes("@"),
  genererMotDePasseTemporaire: () => "TEST-PASS",
}));
vi.mock("@/lib/notifications", () => ({
  creerNotification: async () => {},
  notifierSalarie: async () => {},
  compteSalarieDe: async () => null,
  supprimerNotificationsPour: async () => {},
}));

const { signerMonDocument } = await import("./signature-actions");
const { accepterMonContrat, repondreEchange } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string; // le salarié connecté (A.user.employeeId)
let collegueId: string;
let ligneValideId: string; // bulletin de empId
let ligneBrouillonId: string; // bulletin de empId, non validé
let ligneCollegueId: string; // bulletin de collegueId
let demandeApprouveeId: string; // demande de congé de empId, approuvée (signable)
let contratActifId: string; // contrat ACTIF de empId, pas encore accepté

// Un vrai PNG plausible (en-tête + remplissage), tel qu'exporté par `CadreSignature`.
const ENTETE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_VALIDE = `data:image/png;base64,${Buffer.concat([ENTETE_PNG, Buffer.alloc(200, 0)]).toString("base64")}`;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  const emp = await prisma.employee.create({
    data: {
      matricule: "SA01-PEF", nom: "Salarié A", sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;
  A.user.employeeId = empId;
  const compte = await prisma.user.create({
    data: { email: "salarie.a.signature@test.pef", nom: "Salarié A", role: "EMPLOYE", employeeId: empId },
  });
  A.user.id = compte.id;

  const collegue = await prisma.employee.create({
    data: {
      matricule: "SB01-PEF", nom: "Salarié B", sexe: "M", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  collegueId = collegue.id;

  const runValide = await prisma.payrollRun.create({ data: { mois: 8, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  const runBrouillon = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, statut: "BROUILLON", tauxChangeUtilise: 2800 } });

  const ligneBase = {
    transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
    iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000,
    cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
  };
  ligneValideId = (await prisma.payrollLine.create({
    data: { ...ligneBase, payrollRunId: runValide.id, employeeId: empId, statutPaiement: "VALIDE" },
  })).id;
  ligneBrouillonId = (await prisma.payrollLine.create({
    data: { ...ligneBase, payrollRunId: runBrouillon.id, employeeId: empId, statutPaiement: "PAS_VALIDE" },
  })).id;
  ligneCollegueId = (await prisma.payrollLine.create({
    data: { ...ligneBase, payrollRunId: runValide.id, employeeId: collegueId, statutPaiement: "VALIDE" },
  })).id;

  demandeApprouveeId = (await prisma.leaveRequest.create({
    data: {
      employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-08-03"),
      dateFin: new Date("2026-08-07"), nbJours: 5, statut: "APPROUVE",
    },
  })).id;

  contratActifId = (await prisma.contrat.create({
    data: {
      employeeId: empId, type: "CDI", dateDebut: new Date("2025-01-01"),
      heuresHebdo: 48, salaireMensuel: 300, devise: "USD", poste: "Test", statut: "ACTIF",
    },
  })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("signerMonDocument — espace salarié", () => {
  it("le salarié signe son bulletin validé → ligne créée, mode ESPACE_SALARIE, presenteParId null, traceUrl renvoyé par televerserFichier", async () => {
    const res = await signerMonDocument("BULLETIN", ligneValideId, PNG_VALIDE);
    expect(res).toBeUndefined();

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(sig).not.toBeNull();
    expect(sig?.mode).toBe("ESPACE_SALARIE");
    expect(sig?.presenteParId).toBeNull();
    expect(sig?.traceUrl).toBe(`/fichiers/${S.chemins[0]}`);
    expect(sig?.employeeId).toBe(empId);
  });

  it("il ne peut pas signer le bulletin d'un collègue → erreur, aucune ligne créée", async () => {
    const res = await signerMonDocument("BULLETIN", ligneCollegueId, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: expect.any(String) });

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneCollegueId } },
    });
    expect(sig).toBeNull();
  });

  it("il ne peut pas signer un bulletin en brouillon → erreur, aucune ligne créée", async () => {
    const res = await signerMonDocument("BULLETIN", ligneBrouillonId, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: expect.any(String) });

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneBrouillonId } },
    });
    expect(sig).toBeNull();
  });

  it("il ne peut pas signer deux fois → erreur", async () => {
    const res = await signerMonDocument("BULLETIN", ligneValideId, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: "Ce document est déjà signé." });
  });

  it("une tentative REFUSÉE n'écrase pas le tracé déjà stocké : chaque essai a son propre chemin", async () => {
    // Le téléversement a lieu avant l'écriture en base, et le stockage est en upsert : avec un
    // chemin déterministe, le second essai remplaçait le PNG du premier et le document affichait
    // le tracé d'un autre sous la mention du signataire.
    const dejaSignee = await prisma.signatureElectronique.findUniqueOrThrow({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    S.chemins.length = 0;
    const res = await signerMonDocument("BULLETIN", ligneValideId, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: "Ce document est déjà signé." });

    expect(S.chemins, "la tentative refusée a bien téléversé un fichier").toHaveLength(1);
    expect(
      `/fichiers/${S.chemins[0]}`,
      "la tentative refusée a écrit sur le chemin de la signature valide : elle en a écrasé le tracé"
    ).not.toBe(dejaSignee.traceUrl);
    // ...et la ligne en base continue de désigner le tracé d'origine.
    const apres = await prisma.signatureElectronique.findUniqueOrThrow({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(apres.traceUrl).toBe(dejaSignee.traceUrl);
  });

  it("un tracé qui n'est pas un PNG est refusé → erreur « Signature illisible. »", async () => {
    // Document signable et qui appartient bien au salarié connecté : seul le tracé est en cause.
    const svg = Buffer.from("<svg></svg>").toString("base64");
    const res = await signerMonDocument("DEMANDE_CONGE", demandeApprouveeId, `data:image/svg+xml;base64,${svg}`);
    expect(res).toMatchObject({ erreur: "Signature illisible." });

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "DEMANDE_CONGE", cibleId: demandeApprouveeId } },
    });
    expect(sig).toBeNull();
  });
});

describe("garde espaceEmployeActif — un appel DIRECT à l'action est bloqué, pas seulement le rendu de page", () => {
  // Une Server Action est un point d'entrée HTTP indépendant du rendu de page : couper
  // l'interrupteur du self-service (état par défaut) doit empêcher un appel direct d'écrire une
  // signature ou une acceptation de contrat, même si personne n'a vu de bouton pour le déclencher.
  it("espace désactivé → signerMonDocument est refusé, aucune ligne SignatureElectronique créée", async () => {
    F.espaceEmployeActif = false;
    try {
      const res = await signerMonDocument("DEMANDE_CONGE", demandeApprouveeId, PNG_VALIDE);
      expect(res).toMatchObject({ erreur: expect.any(String) });

      const sig = await prisma.signatureElectronique.findUnique({
        where: { cible_cibleId: { cible: "DEMANDE_CONGE", cibleId: demandeApprouveeId } },
      });
      expect(sig).toBeNull();
    } finally {
      F.espaceEmployeActif = true;
    }
  });

  it("espace désactivé → accepterMonContrat est refusé, accepteLe n'est PAS mis à jour", async () => {
    F.espaceEmployeActif = false;
    try {
      await expect(accepterMonContrat(contratActifId)).rejects.toThrow();

      const contrat = await prisma.contrat.findUnique({ where: { id: contratActifId }, select: { accepteLe: true } });
      expect(contrat?.accepteLe).toBeNull();
    } finally {
      F.espaceEmployeActif = true;
    }
  });

  it("espace désactivé → repondreEchange est refusé, l'échange n'est PAS appliqué (planning inchangé)", async () => {
    // Échange prêt à être finalisé dès la réponse du collègue (Direction déjà APPROUVE) : si la
    // garde ne bloquait pas, accepter permuterait immédiatement les deux créneaux du planning.
    const shiftA = await prisma.shift.create({ data: { nom: "Matin", dureeHeures: 8, ordre: 0 } });
    const shiftB = await prisma.shift.create({ data: { nom: "Soir", dureeHeures: 8, ordre: 1 } });
    const date = new Date("2026-09-01T00:00:00.000Z");

    await prisma.planningCreneau.create({ data: { employeeId: collegueId, date, shiftId: shiftA.id } }); // demandeur (Salarié B)
    await prisma.planningCreneau.create({ data: { employeeId: empId, date, shiftId: shiftB.id } }); // collègue connecté (Salarié A)

    const ech = await prisma.echangeCreneau.create({
      data: {
        demandeurId: collegueId, demandeurDate: date, demandeurShiftId: shiftA.id,
        collegueId: empId, collegueDate: date, collegueShiftId: shiftB.id,
        statut: "EN_ATTENTE", reponseDirection: "APPROUVE",
      },
    });

    F.espaceEmployeActif = false;
    try {
      await expect(repondreEchange(ech.id, true)).rejects.toThrow();

      const relu = await prisma.echangeCreneau.findUnique({ where: { id: ech.id } });
      expect(relu?.statut).toBe("EN_ATTENTE");
      expect(relu?.reponseCollegue).toBe("EN_ATTENTE");

      // Le planning n'a pas bougé : aucun des deux salariés n'a récupéré le créneau de l'autre.
      const [creneauDemandeur, creneauCollegue] = await Promise.all([
        prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId: collegueId, date } } }),
        prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId: empId, date } } }),
      ]);
      expect(creneauDemandeur?.shiftId).toBe(shiftA.id);
      expect(creneauCollegue?.shiftId).toBe(shiftB.id);
    } finally {
      F.espaceEmployeActif = true;
    }
  });
});
