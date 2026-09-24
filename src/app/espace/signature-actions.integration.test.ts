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
// Ce que la Direction reçoit (cloche + e-mail + push) : on retient chaque message.
const N = vi.hoisted(() => ({ direction: [] as { message: string; lien?: string }[] }));
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
// Le RENDU du PDF est couvert par `lib/pdf/contrat-signature.integration.test.ts` ; ici on vérifie
// seulement que la signature d'un contrat FIGE un exemplaire (et que son échec ne défait rien).
const P = vi.hoisted(() => ({ enPanne: false }));
vi.mock("@/lib/pdf/contrat-buffer", () => ({
  genererContratPdf: async () => {
    if (P.enPanne) throw new Error("rendu PDF en panne");
    return { buffer: Buffer.from("%PDF-FIGE"), nomFichier: "c.pdf", employeeId: "x", figeable: true };
  },
}));
vi.mock("@/lib/notifications", () => ({
  creerNotification: async (n: { message: string; lien?: string }) => { N.direction.push(n); },
  notifierSalarie: async () => {},
  compteSalarieDe: async () => null,
  supprimerNotificationsPour: async () => {},
}));

const { signerMonDocument } = await import("./signature-actions");
const { repondreEchange } = await import("./actions");

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

  it("espace désactivé → signer son contrat est refusé : ni signature, ni acceptation", async () => {
    F.espaceEmployeActif = false;
    try {
      const res = await signerMonDocument("CONTRAT", contratActifId, PNG_VALIDE);
      expect(res).toMatchObject({ erreur: "Accès refusé." });

      const contrat = await prisma.contrat.findUnique({ where: { id: contratActifId }, select: { accepteLe: true } });
      expect(contrat?.accepteLe, "espace fermé : l'acceptation a été écrite quand même").toBeNull();
      const sig = await prisma.signatureElectronique.findUnique({
        where: { cible_cibleId: { cible: "CONTRAT", cibleId: contratActifId } },
      });
      expect(sig).toBeNull();
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

// SIGNER VAUT ACCEPTATION FORMELLE (décision de la Direction, 2026-09-23). Chaque assertion RELIT
// la base : c'est `Contrat.accepteLe` qui fait foi, pas ce que l'action renvoie.
describe("signer un contrat depuis l'espace vaut acceptation", () => {
  const relire = async (contratId: string) => {
    const [contrat, sig] = await Promise.all([
      prisma.contrat.findUniqueOrThrow({ where: { id: contratId } }),
      prisma.signatureElectronique.findUnique({ where: { cible_cibleId: { cible: "CONTRAT", cibleId: contratId } } }),
    ]);
    return { contrat, sig };
  };
  const nouveauContrat = (employeeId: string) =>
    prisma.contrat.create({
      data: {
        employeeId, type: "CDD", dateDebut: new Date("2026-01-01"), dateFin: new Date("2026-12-31"),
        heuresHebdo: 48, salaireMensuel: 350, devise: "USD", poste: "Test", statut: "ACTIF",
      },
    });

  it("pose accepteLe = signeLe (même instant), fige l'exemplaire et prévient la Direction", async () => {
    N.direction.length = 0;
    const res = await signerMonDocument("CONTRAT", contratActifId, PNG_VALIDE);
    expect(res).toBeUndefined();

    const { contrat, sig } = await relire(contratActifId);
    expect(sig).not.toBeNull();
    expect(contrat.accepteLe, "contrat signé sans acceptation").not.toBeNull();
    expect(contrat.accepteLe!.getTime(), "l'acceptation n'est pas l'instant de la signature").toBe(sig!.signeLe.getTime());
    expect(contrat.pdfAccepteUrl, "l'exemplaire qui fait foi n'a pas été figé").toBe(`/fichiers/contrats/${contratActifId}-${sig!.signeLe.getTime()}.pdf`);
    expect(contrat.pdfAccepteObsolete).toBe(false);
    expect(N.direction.map((n) => n.message)).toEqual(["Salarié A a signé son contrat (CDI)."]);
    expect(N.direction[0].lien).toBe(`/employes/${empId}?tab=contrats`);
  });

  it("RE-signer après obsolescence est l'acceptation de la NOUVELLE version : accepteLe avance", async () => {
    const avant = await relire(contratActifId);
    // La Direction corrige le salaire : la signature devient « à resigner » à la lecture suivante.
    await prisma.contrat.update({ where: { id: contratActifId }, data: { salaireMensuel: 320 } });
    const { chargerSignature } = await import("@/lib/signature");
    expect((await chargerSignature(prisma, "CONTRAT", contratActifId))?.obsolete).toBe(true);

    await new Promise((r) => setTimeout(r, 5)); // deux instants distincts à la milliseconde
    const res = await signerMonDocument("CONTRAT", contratActifId, PNG_VALIDE);
    expect(res).toBeUndefined();

    const apres = await relire(contratActifId);
    expect(apres.sig!.obsolete).toBe(false);
    expect(apres.contrat.accepteLe!.getTime(), "la re-signature n'a pas mis l'acceptation à jour").toBe(apres.sig!.signeLe.getTime());
    expect(apres.contrat.accepteLe!.getTime()).toBeGreaterThan(avant.contrat.accepteLe!.getTime());
  });

  it("déjà signé (et à jour) → refus, accepteLe INCHANGÉ", async () => {
    const avant = await relire(contratActifId);
    const res = await signerMonDocument("CONTRAT", contratActifId, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: "Ce document est déjà signé." });

    const apres = await relire(contratActifId);
    expect(apres.contrat.accepteLe!.getTime(), "un refus a déplacé l'acceptation").toBe(avant.contrat.accepteLe!.getTime());
    expect(apres.sig!.signeLe.getTime()).toBe(avant.sig!.signeLe.getTime());
  });

  it("le contrat d'un COLLÈGUE → refus, son contrat n'est pas accepté", async () => {
    const c = await nouveauContrat(collegueId);
    const res = await signerMonDocument("CONTRAT", c.id, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: "Ce document ne vous appartient pas." });

    const { contrat, sig } = await relire(c.id);
    expect(contrat.accepteLe, "le contrat d'un collègue a été accepté à sa place").toBeNull();
    expect(sig).toBeNull();
  });

  it("signer un BULLETIN ou une DEMANDE DE CONGÉ ne modifie aucun contrat", async () => {
    // Deux documents neufs du salarié, et un contrat actif qui n'a jamais été signé.
    const c = await nouveauContrat(empId);
    const run = await prisma.payrollRun.create({ data: { mois: 7, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    const ligne = await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId: empId, statutPaiement: "VALIDE",
        transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10,
        allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000, cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
      },
    });
    const demande = await prisma.leaveRequest.create({
      data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-10-05"), dateFin: new Date("2026-10-09"), nbJours: 5, statut: "APPROUVE" },
    });
    const photo = async () => JSON.stringify(await prisma.contrat.findMany({ orderBy: { id: "asc" } }));
    const avant = await photo();

    expect(await signerMonDocument("BULLETIN", ligne.id, PNG_VALIDE)).toBeUndefined();
    expect(await signerMonDocument("DEMANDE_CONGE", demande.id, PNG_VALIDE)).toBeUndefined();

    expect(await photo(), "signer un bulletin ou un congé a modifié un contrat").toBe(avant);
    expect((await relire(c.id)).contrat.accepteLe).toBeNull();
  });

  it("le figeage de l'exemplaire en panne ne bloque JAMAIS l'acceptation", async () => {
    const c = await nouveauContrat(empId);
    P.enPanne = true;
    try {
      const res = await signerMonDocument("CONTRAT", c.id, PNG_VALIDE);
      expect(res, "une panne du rendu PDF a fait échouer la signature").toBeUndefined();
    } finally {
      P.enPanne = false;
    }
    const { contrat, sig } = await relire(c.id);
    expect(contrat.accepteLe!.getTime()).toBe(sig!.signeLe.getTime());
    expect(contrat.pdfAccepteUrl, "à défaut de figeage, le contrat est régénéré à la volée").toBeNull();
  });

  it("un contrat accepté d'un CLIC avant ce lot reste accepté, à sa date d'origine", async () => {
    // Exactement ce que la migration 20260923090000 a écrit : acceptation au clic + signature
    // reprise SANS tracé, empreinte vide, à la date d'acceptation.
    const acceptation = new Date("2026-07-20T08:40:00.000Z");
    const c = await nouveauContrat(empId);
    await prisma.contrat.update({ where: { id: c.id }, data: { accepteLe: acceptation, pdfAccepteUrl: `/fichiers/contrats/${c.id}.pdf` } });
    await prisma.signatureElectronique.create({
      data: {
        cible: "CONTRAT", cibleId: c.id, employeeId: empId, traceUrl: null, signeLe: acceptation,
        mode: "ESPACE_SALARIE", donnees: {}, empreinte: "", obsolete: false,
      },
    });
    // Même si ses conditions ont bougé depuis, il ne bascule ni en « à signer » ni en « à resigner ».
    await prisma.contrat.update({ where: { id: c.id }, data: { salaireMensuel: 999 } });

    const { chargerSignature, etatSignature } = await import("@/lib/signature");
    expect(etatSignature(await chargerSignature(prisma, "CONTRAT", c.id)).etat).toBe("SIGNE");

    // ...et une tentative de signature ne le ré-accepte pas.
    const res = await signerMonDocument("CONTRAT", c.id, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: "Ce document est déjà signé." });
    const { contrat, sig } = await relire(c.id);
    expect(contrat.accepteLe!.getTime(), "l'acceptation d'origine a été déplacée").toBe(acceptation.getTime());
    expect(contrat.pdfAccepteUrl, "l'exemplaire figé d'origine a été retiré").toBe(`/fichiers/contrats/${c.id}.pdf`);
    expect(sig!.traceUrl).toBeNull();
    expect(sig!.obsolete).toBe(false);
  });
});

// Le planning est une pièce de paie (2026-09-23) : un échange accepté depuis l'espace passe par
// `ecrireCreneaux`, au nom du salarié qui accepte ; paie du mois validée → rien n'est permuté,
// l'échange reste en attente et la Direction est prévenue du blocage.
describe("repondreEchange — verrou de paie et trace du planning", () => {
  it("mois dont la paie est validée → échange bloqué, planning inchangé, la Direction est prévenue", async () => {
    const [shiftA, shiftB] = await Promise.all([
      prisma.shift.create({ data: { nom: "Matin verrou", dureeHeures: 8, ordre: 10 } }),
      prisma.shift.create({ data: { nom: "Soir verrou", dureeHeures: 8, ordre: 11 } }),
    ]);
    const date = new Date("2026-08-12T00:00:00.000Z"); // août : paies de A et B VALIDÉES
    await prisma.planningCreneau.createMany({ data: [
      { employeeId: collegueId, date, shiftId: shiftA.id },
      { employeeId: empId, date, shiftId: shiftB.id },
    ] });
    const ech = await prisma.echangeCreneau.create({ data: {
      demandeurId: collegueId, demandeurDate: date, demandeurShiftId: shiftA.id,
      collegueId: empId, collegueDate: date, collegueShiftId: shiftB.id, reponseDirection: "APPROUVE",
    } });
    N.direction.length = 0;

    await repondreEchange(ech.id, true);

    const relu = await prisma.echangeCreneau.findUniqueOrThrow({ where: { id: ech.id } });
    expect([relu.statut, relu.reponseCollegue]).toEqual(["EN_ATTENTE", "ACCEPTE"]);
    expect((await prisma.planningCreneau.findUniqueOrThrow({ where: { employeeId_date: { employeeId: collegueId, date } } })).shiftId).toBe(shiftA.id);
    expect((await prisma.planningCreneau.findUniqueOrThrow({ where: { employeeId_date: { employeeId: empId, date } } })).shiftId).toBe(shiftB.id);
    expect(N.direction.map((n) => [n.message, n.lien])).toEqual([[
      "Échange de shift accepté mais bloqué : Planning verrouillé : paie validée ou payée pour Salarié A (août 2026), Salarié B (août 2026). Rouvrir la ligne de paie avant de modifier ce planning.",
      "/a-valider",
    ]]);
  });

  it("mois ouvert → échange appliqué et journalisé au nom du salarié qui accepte", async () => {
    const [shiftA, shiftB] = await Promise.all([
      prisma.shift.create({ data: { nom: "Matin ouvert", dureeHeures: 8, ordre: 12 } }),
      prisma.shift.create({ data: { nom: "Soir ouvert", dureeHeures: 8, ordre: 13 } }),
    ]);
    const date = new Date("2026-09-15T00:00:00.000Z"); // septembre : paie en brouillon
    await prisma.planningCreneau.createMany({ data: [
      { employeeId: collegueId, date, shiftId: shiftA.id },
      { employeeId: empId, date, shiftId: shiftB.id },
    ] });
    const ech = await prisma.echangeCreneau.create({ data: {
      demandeurId: collegueId, demandeurDate: date, demandeurShiftId: shiftA.id,
      collegueId: empId, collegueDate: date, collegueShiftId: shiftB.id, reponseDirection: "APPROUVE",
    } });

    await repondreEchange(ech.id, true);

    expect((await prisma.echangeCreneau.findUniqueOrThrow({ where: { id: ech.id } })).statut).toBe("APPROUVE");
    expect((await prisma.planningCreneau.findUniqueOrThrow({ where: { employeeId_date: { employeeId: collegueId, date } } })).shiftId).toBe(shiftB.id);
    expect((await prisma.planningCreneau.findUniqueOrThrow({ where: { employeeId_date: { employeeId: empId, date } } })).shiftId).toBe(shiftA.id);
    const j = await prisma.journalAudit.findMany({ where: { entite: "PlanningCreneau", entiteId: { endsWith: "|2026-09-15" } } });
    expect(j).toHaveLength(2);
    expect(j.every((e) => e.userId === A.user.id)).toBe(true);
  });
});
