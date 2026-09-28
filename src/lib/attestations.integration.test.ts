import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { creerBaseTest } from "@/lib/test/db";

// ATTESTATIONS (spec 2026-09-28, lot 4) : numéro unique par année, attribué sous verrou ; une
// seule demande en cours par type ; éligibilité vérifiée À LA DÉLIVRANCE (paie validée, type de
// contrat) ; refus automatique et lisible d'une demande inéligible.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const N = vi.hoisted(() => ({ salarie: [] as { userId: string; message: string; lien?: string }[], direction: [] as string[] }));
const F = vi.hoisted(() => ({ figees: [] as string[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/storage", () => ({
  televerserFichier: async (chemin: string) => { F.figees.push(chemin); return `/fichiers/${chemin}`; },
  lireFichier: async () => null,
}));
vi.mock("@/lib/pdf/attestation-buffer", () => ({ rendreAttestationPdf: async () => Buffer.from("%PDF-ATT") }));
vi.mock("@/lib/notifications", () => ({
  notifierSalarie: async (userId: string, n: { message: string; lien?: string }) => { N.salarie.push({ userId, ...n }); },
  compteSalarieDe: async (employeeId: string) => {
    const u = await H.client.user.findUnique({ where: { employeeId } });
    return u && u.actif ? u.id : null;
  },
  creerNotification: async (n: { message: string }) => { N.direction.push(n.message); },
  supprimerNotificationsPour: async () => {},
}));

const { demanderAttestation, delivrerAttestation, refuserAttestation, instantaneAttestation } = await import("@/lib/attestations");
const { brutHorsTransportUSD } = await import("@/lib/paie-net");

let prisma: PrismaClient;
let url: string;
let fermer: () => Promise<void>;
let directionId: string;
let seq = 0;
const MAINTENANT = new Date("2026-09-28T10:00:00Z");

type Opt = { contrat?: "CDI" | "CDD" | "STAGE" | "INTERIM"; actif?: boolean; avecCompte?: boolean; dateEmbauche?: string };
async function salarie(o: Opt = {}) {
  seq++;
  const emp = await prisma.employee.create({
    data: {
      matricule: `AT${seq}-PEF`, nom: `Salariée ${seq}`, sexe: "F", etatCivil: "Célibataire",
      poste: "Cuisinière", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date(o.dateEmbauche ?? "2024-03-01"), contrat: o.contrat ?? "CDI", actif: o.actif ?? true,
    },
  });
  if (o.avecCompte !== false) {
    await prisma.user.create({ data: { email: `at${seq}@salarie.local`, nom: emp.nom, role: "EMPLOYE", employeeId: emp.id } });
  }
  return emp.id;
}
async function contrat(employeeId: string, type: "CDI" | "CDD" | "STAGE" | "INTERIM", debut: string, fin: string | null, statut: "ACTIF" | "RESILIE" | "EXPIRE" = "ACTIF") {
  return prisma.contrat.create({
    data: { employeeId, type, dateDebut: new Date(debut), dateFin: fin ? new Date(fin) : null, heuresHebdo: 48, salaireMensuel: 300, devise: "USD", poste: "Cuisinière", statut },
  });
}
async function paie(employeeId: string, mois: number, annee: number, statut: "PAS_VALIDE" | "VALIDE" | "PAYE", net = 290, brut = 330, alloc = 0, avances: { acompte?: number; pret?: number; fraisMedicaux?: number } = {}) {
  // `net` = salaire net habituel ; le net stocké (versé) retranche transport, acompte et prêt comme le moteur.
  const acompte = avances.acompte ?? 0;
  const pret = avances.pret ?? 0;
  const frais = avances.fraisMedicaux ?? 0;
  const run =
    (await prisma.payrollRun.findUnique({ where: { mois_annee: { mois, annee } } })) ??
    (await prisma.payrollRun.create({ data: { mois, annee, statut: "BROUILLON", tauxChangeUtilise: 2800 } }));
  return prisma.payrollLine.create({
    data: {
      payrollRunId: run.id, employeeId, statutPaiement: statut, transportUSD: 15, salBrutUSD: brut, cnssSalarieUSD: 15,
      netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: alloc, acompteUSD: acompte, retenuePretUSD: pret, fraisMedicauxUSD: frais,
      salNetUSD: net + 15 + frais - acompte - pret, salNetCDF: (net + 15 + frais - acompte - pret) * 2800,
      cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
    },
  });
}
const delivrer = (p: { attestationId?: string; employeeId?: string; type?: "TRAVAIL" | "SALAIRE" | "STAGE"; maintenant?: Date }) =>
  delivrerAttestation(prisma, { parId: directionId, maintenant: MAINTENANT, ...p });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; url = db.url; fermer = db.fermer; H.client = prisma;
  directionId = (await prisma.user.create({ data: { email: "direction.att@test.pef", nom: "La Direction", role: "ADMIN" } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });
beforeEach(() => { N.salarie.length = 0; N.direction.length = 0; F.figees.length = 0; });

describe("numéro d'attestation", () => {
  it("ATT-AAAA-NNNN, séquence par année (l'année de Kinshasa)", async () => {
    const a = await salarie();
    const r1 = await delivrer({ employeeId: a, type: "TRAVAIL" });
    const r2 = await delivrer({ employeeId: a, type: "TRAVAIL" });
    // 31/12 à 23 h 30 UTC = déjà le 1er janvier à Kinshasa
    const r3 = await delivrer({ employeeId: a, type: "TRAVAIL", maintenant: new Date("2026-12-31T23:30:00Z") });
    const r4 = await delivrer({ employeeId: a, type: "TRAVAIL", maintenant: new Date("2027-01-05T10:00:00Z") });
    expect([r1, r2, r3, r4].map((r) => (r.ok ? r.numero : r.motif))).toEqual(["ATT-2026-0001", "ATT-2026-0002", "ATT-2027-0001", "ATT-2027-0002"]);
  });

  it("deux délivrances SIMULTANÉES tirent deux numéros distincts", async () => {
    const a = await salarie();
    // Deux clients distincts, deux connexions : une vraie concurrence en base, pas deux appels en file.
    const autre = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    try {
      const rs = await Promise.all([
        delivrerAttestation(prisma, { employeeId: a, type: "TRAVAIL", parId: directionId, maintenant: new Date("2028-02-01T10:00:00Z") }),
        delivrerAttestation(autre, { employeeId: a, type: "TRAVAIL", parId: directionId, maintenant: new Date("2028-02-01T10:00:00Z") }),
        delivrerAttestation(prisma, { employeeId: a, type: "TRAVAIL", parId: directionId, maintenant: new Date("2028-02-01T10:00:00Z") }),
        delivrerAttestation(autre, { employeeId: a, type: "TRAVAIL", parId: directionId, maintenant: new Date("2028-02-01T10:00:00Z") }),
      ]);
      const numeros = rs.map((r) => (r.ok ? r.numero : r.motif)).sort();
      expect(numeros).toEqual(["ATT-2028-0001", "ATT-2028-0002", "ATT-2028-0003", "ATT-2028-0004"]);
    } finally {
      await autre.$disconnect();
    }
  });

  it("un numéro n'est jamais réutilisé, même si l'attestation disparaît", async () => {
    const a = await salarie();
    const r1 = await delivrer({ employeeId: a, type: "TRAVAIL", maintenant: new Date("2029-03-01T10:00:00Z") });
    if (!r1.ok) throw new Error(r1.motif);
    await prisma.attestation.delete({ where: { id: r1.id } });
    const r2 = await delivrer({ employeeId: a, type: "TRAVAIL", maintenant: new Date("2029-03-02T10:00:00Z") });
    expect(r2.ok && r2.numero).toBe("ATT-2029-0002");
  });
});

describe("attestation de travail", () => {
  it("en poste : date d'EMBAUCHE (pas le début du contrat en cours), toujours en fonction", async () => {
    const a = await salarie({ dateEmbauche: "2023-05-02" });
    await contrat(a, "CDD", "2023-05-02", "2023-12-31", "EXPIRE");
    await contrat(a, "CDI", "2024-01-01", null);
    const r = await instantaneAttestation(prisma, a, "TRAVAIL", MAINTENANT);
    expect(r).toEqual({
      ok: true,
      payrollLineId: null,
      donnees: expect.objectContaining({ dateEmbauche: "2023-05-02", enPoste: true, dateSortie: null, typeContrat: "CDI — durée indéterminée" }),
    });
  });

  it("sorti : jusqu'à la date de sortie (fin de contrat enregistrée)", async () => {
    const a = await salarie({ actif: false });
    await contrat(a, "CDI", "2024-03-01", null, "RESILIE");
    await prisma.finContrat.create({
      data: { employeeId: a, motif: "DEMISSION", dateFin: new Date("2026-06-30"), salaireJournalierUSD: 0, joursTravaillesMois: 0, salaireProrataUSD: 0, joursCongesNonPris: 0, indemniteCongesUSD: 0, preavisJours: 0, indemnitePreavisUSD: 0, indemniteLicenciementUSD: 0, autresUSD: 0, totalUSD: 0, creeParId: directionId },
    });
    const r = await instantaneAttestation(prisma, a, "TRAVAIL", MAINTENANT);
    expect(r.ok && r.donnees).toEqual(expect.objectContaining({ enPoste: false, dateSortie: "2026-06-30" }));
  });

  it("sorti sans fin de contrat enregistrée : la date de fin du dernier contrat", async () => {
    const a = await salarie({ actif: false });
    await contrat(a, "CDD", "2025-01-01", "2025-12-31", "EXPIRE");
    const r = await instantaneAttestation(prisma, a, "TRAVAIL", MAINTENANT);
    expect(r.ok && r.donnees.dateSortie).toBe("2025-12-31");
  });

  it("sorti sans AUCUNE date de sortie : refus lisible, jamais « au — »", async () => {
    const a = await salarie({ actif: false });
    await contrat(a, "CDI", "2024-03-01", null, "RESILIE");
    const r = await instantaneAttestation(prisma, a, "TRAVAIL", MAINTENANT);
    expect(r).toEqual({ ok: false, motif: "Votre date de sortie n'est pas enregistrée : la Direction doit la compléter.", aCompleter: true });
  });
});

describe("attestation de salaire", () => {
  it("dernière paie VALIDE ou PAYE — un brouillon plus récent est ignoré", async () => {
    const a = await salarie();
    await paie(a, 7, 2026, "PAYE", 280, 320, 3);
    const aout = await paie(a, 8, 2026, "VALIDE", 290, 330, 4.5);
    await paie(a, 9, 2026, "PAS_VALIDE", 999, 999);
    const r = await instantaneAttestation(prisma, a, "SALAIRE", MAINTENANT);
    expect(r).toEqual({
      ok: true,
      payrollLineId: aout.id,
      donnees: expect.objectContaining({
        // Brut HORS transport (330 − 15), comme la base imposable du bulletin.
        salaire: { mois: 8, annee: 2026, netUSD: "290.00", brutUSD: "315.00", allocationsUSD: "4.50", tauxChange: "2800.00" },
      }),
    });
  });

  it("net HABITUEL : ni l'acompte ni le prêt ne le diminuent, les frais médicaux remboursés ne le gonflent pas", async () => {
    const a = await salarie();
    // Versé 250 $ = 300 net + 15 transport + 45 frais médicaux − 80 acompte − 30 prêt.
    const l = await paie(a, 8, 2026, "PAYE", 300, 340, 0, { acompte: 80, pret: 30, fraisMedicaux: 45 });
    expect(Number(l.salNetUSD)).toBe(250);
    const r = await instantaneAttestation(prisma, a, "SALAIRE", MAINTENANT);
    expect(r.ok && r.donnees.salaire).toEqual(expect.objectContaining({ netUSD: "300.00", brutUSD: "325.00" }));
  });

  it("brut attesté = brut HORS transport (assiette CNSS/IPR), la formule du bulletin", async () => {
    const a = await salarie();
    const run = await prisma.payrollRun.create({ data: { mois: 3, annee: 2031, statut: "BROUILLON", tauxChangeUtilise: 2800 } });
    await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId: a, statutPaiement: "PAYE", transportUSD: 42.5, salBrutUSD: 400, cnssSalarieUSD: 17.88,
        netImposableUSD: 339.62, iprCalculeUSD: 12, allocFamilialeUSD: 0, salNetUSD: 412.62, salNetCDF: 0,
        cnssPatronalUSD: 36, coutEmployeurUSD: 436, coutEmployeurCDF: 0,
      },
    });
    const r = await instantaneAttestation(prisma, a, "SALAIRE", MAINTENANT);
    expect(r.ok && r.donnees.salaire?.brutUSD).toBe("357.50");
    expect(r.ok && r.donnees.salaire?.brutUSD).toBe(brutHorsTransportUSD({ salBrutUSD: 400, transportUSD: 42.5 }).toFixed(2));
  });

  it("aucune paie validée → refus", async () => {
    const a = await salarie();
    await paie(a, 9, 2026, "PAS_VALIDE");
    expect(await instantaneAttestation(prisma, a, "SALAIRE", MAINTENANT)).toEqual({ ok: false, motif: expect.stringMatching(/Aucune paie validée/) });
  });

  it("stagiaire ou intérimaire → refus", async () => {
    const st = await salarie({ contrat: "STAGE" });
    await contrat(st, "STAGE", "2026-06-01", "2026-11-30");
    await paie(st, 8, 2026, "PAYE");
    expect(await instantaneAttestation(prisma, st, "SALAIRE", MAINTENANT)).toEqual({ ok: false, motif: expect.stringMatching(/stagiaire ou un intérimaire/) });
    const it_ = await salarie({ contrat: "INTERIM" });
    expect(await instantaneAttestation(prisma, it_, "SALAIRE", MAINTENANT)).toEqual({ ok: false, motif: expect.stringMatching(/stagiaire ou un intérimaire/) });
  });
});

describe("attestation de stage", () => {
  it("le dernier contrat de stage ; sans stage → refus", async () => {
    const st = await salarie({ contrat: "STAGE" });
    await contrat(st, "STAGE", "2026-03-01", "2026-08-31");
    const r = await instantaneAttestation(prisma, st, "STAGE", MAINTENANT);
    expect(r.ok && r.donnees.stage).toEqual({ debut: "2026-03-01", fin: "2026-08-31" });
    const cdi = await salarie();
    expect(await instantaneAttestation(prisma, cdi, "STAGE", MAINTENANT)).toEqual({ ok: false, motif: expect.stringMatching(/contrat de stage/) });
  });
});

describe("circuit : demande → délivrance ou refus", () => {
  it("une seule demande EN COURS par type, même sous deux demandes simultanées", async () => {
    const a = await salarie();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const rs = await Promise.all([
      demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId }),
      demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, motif: "Une demande d'attestation de travail est déjà en cours." });
    expect(await prisma.attestation.count({ where: { employeeId: a, statut: "DEMANDEE" } })).toBe(1);
    // Un AUTRE type reste possible.
    expect((await demanderAttestation(prisma, { employeeId: a, type: "SALAIRE", motif: "banque", parId: userId })).ok).toBe(false); // pas de paie
    expect(N.direction.length).toBe(1);
  });

  it("la vérification « déjà en cours » attend une demande concurrente non encore validée (verrou de ligne)", async () => {
    const a = await salarie();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    // Une AUTRE transaction tient la ligne du salarié et insère une demande sans l'avoir encore validée.
    const concurrent = new Client({ connectionString: url });
    await concurrent.connect();
    try {
      await concurrent.query("BEGIN");
      await concurrent.query(`SELECT "id" FROM "public"."Employee" WHERE "id" = $1 FOR UPDATE`, [a]);
      await concurrent.query(
        `INSERT INTO "public"."Attestation" ("id", "employeeId", "type", "statut", "updatedAt") VALUES (gen_random_uuid()::text, $1, 'TRAVAIL', 'DEMANDEE', NOW())`,
        [a],
      );
      const demande = demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId });
      await new Promise((r) => setTimeout(r, 400)); // sans verrou, la demande serait déjà écrite ici
      await concurrent.query("COMMIT");
      expect(await demande).toEqual({ ok: false, motif: "Une demande d'attestation de travail est déjà en cours." });
      expect(await prisma.attestation.count({ where: { employeeId: a, statut: "DEMANDEE" } })).toBe(1);
    } finally {
      await concurrent.end();
    }
  });

  it("délivrer une demande : numéro, instantané, exemplaire figé, journal, salarié notifié", async () => {
    const a = await salarie();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const d = await demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: "dossier de visa", parId: userId });
    if (!d.ok) throw new Error(d.motif);
    const r = await delivrer({ attestationId: d.id });
    if (!r.ok) throw new Error(r.motif);
    const att = await prisma.attestation.findUniqueOrThrow({ where: { id: d.id } });
    expect(att).toEqual(expect.objectContaining({ statut: "DELIVREE", numero: r.numero, delivreeParId: directionId, pdfUrl: `/fichiers/${F.figees[0]}` }));
    expect(att.donnees).toEqual(expect.objectContaining({ type: "TRAVAIL", matricule: expect.stringMatching(/PEF$/) }));
    expect(await prisma.journalAudit.count({ where: { entite: "Attestation", entiteId: d.id, champ: "delivrance", nouvelleValeur: r.numero } })).toBe(1);
    expect(N.salarie).toEqual([expect.objectContaining({ userId, message: `Votre attestation de travail (${r.numero}) est disponible`, lien: "/espace/attestations" })]);
    // Une demande déjà délivrée ne se redélivre pas.
    expect(await delivrer({ attestationId: d.id })).toEqual({ ok: false, motif: "Cette demande a déjà été traitée." });
  });

  it("une demande devenue inéligible est REFUSÉE automatiquement, avec son motif", async () => {
    const a = await salarie();
    await paie(a, 8, 2026, "VALIDE");
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const d = await demanderAttestation(prisma, { employeeId: a, type: "SALAIRE", motif: null, parId: userId });
    if (!d.ok) throw new Error(d.motif);
    await prisma.payrollLine.updateMany({ where: { employeeId: a }, data: { statutPaiement: "PAS_VALIDE" } }); // paie dévalidée entre-temps
    const r = await delivrer({ attestationId: d.id });
    expect(r).toEqual({ ok: false, motif: expect.stringMatching(/Aucune paie validée/), refusee: true });
    const att = await prisma.attestation.findUniqueOrThrow({ where: { id: d.id } });
    expect(att).toEqual(expect.objectContaining({ statut: "REFUSEE", numero: null, motifRefus: expect.stringMatching(/Aucune paie validée/) }));
  });

  it("refuser exige un motif ; le salarié est prévenu ; une demande traitée ne se refuse plus", async () => {
    const a = await salarie();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const d = await demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId });
    if (!d.ok) throw new Error(d.motif);
    expect(await refuserAttestation(prisma, { id: d.id, motif: "  ", parId: directionId })).toEqual({ ok: false, motif: "Indiquez le motif du refus." });
    expect(await refuserAttestation(prisma, { id: d.id, motif: "Pièce manquante", parId: directionId })).toEqual({ ok: true });
    expect((await prisma.attestation.findUniqueOrThrow({ where: { id: d.id } })).motifRefus).toBe("Pièce manquante");
    expect(N.salarie.map((n) => n.message)).toEqual(["Votre demande d'attestation de travail a été refusée : Pièce manquante"]);
    expect(await refuserAttestation(prisma, { id: d.id, motif: "encore", parId: directionId })).toEqual({ ok: false, motif: "Cette demande a déjà été traitée." });
  });

  it("délivrer directement depuis la fiche SATISFAIT la demande du même type en attente", async () => {
    const a = await salarie();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const d = await demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId });
    if (!d.ok) throw new Error(d.motif);
    const r = await delivrer({ employeeId: a, type: "TRAVAIL" });
    expect(r.ok && r.id).toBe(d.id);
    expect(await prisma.attestation.count({ where: { employeeId: a } })).toBe(1);
  });

  it("délivrance directe inéligible : rien n'est écrit", async () => {
    const st = await salarie({ contrat: "STAGE" });
    const avant = await prisma.attestation.count();
    expect((await delivrer({ employeeId: st, type: "SALAIRE" })).ok).toBe(false);
    expect(await prisma.attestation.count()).toBe(avant);
  });
});

describe("date d'effet : seule une paie à partir de la paie au planning fait foi (décision du 2026-09-28)", () => {
  it("un juin PAYÉ est ignoré, un septembre VALIDÉ est retenu ; sans paie depuis l'effet, refus clair — le travail reste possible", async () => {
    const ex = await prisma.exerciceFiscal.create({ data: { annee: 2026, actif: true } });
    await prisma.parametreLegal.create({ data: { exerciceId: ex.id, cle: "paie_reference_planning_depuis", valeur: 202609, unite: "AAAAMM", libelle: "Paie au planning depuis" } });
    try {
      const a = await salarie();
      await paie(a, 6, 2026, "PAYE", 250, 300);
      expect(await instantaneAttestation(prisma, a, "SALAIRE", MAINTENANT)).toEqual({
        ok: false,
        motif: "Aucune paie validée depuis septembre 2026 : la Direction doit d'abord valider la paie.",
      });
      expect((await instantaneAttestation(prisma, a, "TRAVAIL", MAINTENANT)).ok).toBe(true);
      const sept = await paie(a, 9, 2026, "VALIDE", 310, 360);
      const r = await instantaneAttestation(prisma, a, "SALAIRE", MAINTENANT);
      expect(r.ok && r.payrollLineId).toBe(sept.id);
      expect(r.ok && r.donnees.salaire?.mois).toBe(9);
    } finally {
      await prisma.exerciceFiscal.delete({ where: { id: ex.id } });
    }
  });
});

describe("motifs lisibles par le salarié", () => {
  it("date de sortie manquante : phrase pour le salarié, et la Direction est prévenue de compléter la fiche", async () => {
    const a = await salarie({ actif: false });
    await contrat(a, "CDI", "2024-03-01", null, "RESILIE");
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const r = await demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId });
    expect(r).toEqual({ ok: false, motif: "Votre date de sortie n'est pas enregistrée : la Direction doit la compléter." });
    expect(N.direction.some((m) => m.includes("Complétez la fiche"))).toBe(true);
  });
});

describe("course entre la fiche et « Demandes de validation » (relecture du 2026-09-28)", () => {
  // Transaction A = « Demandes de validation » traite la demande, arrêtée avant COMMIT ; pendant ce
  // temps, B = « Délivrer une attestation » depuis la fiche, même salarié, même type.
  async function course(traitementA: "DELIVREE" | "REFUSEE") {
    const a = await salarie();
    const dem = await prisma.attestation.create({ data: { employeeId: a, type: "TRAVAIL" } });
    const tA = new Client({ connectionString: url });
    await tA.connect();
    let numA: string | null = null;
    try {
      await tA.query("BEGIN");
      await tA.query(`SELECT "id" FROM "public"."Attestation" WHERE "id"=$1 FOR UPDATE`, [dem.id]);
      if (traitementA === "DELIVREE") {
        const { rows } = await tA.query(
          `INSERT INTO "public"."CompteurAttestation" ("annee","dernier") VALUES (2032,1) ON CONFLICT ("annee") DO UPDATE SET "dernier"="CompteurAttestation"."dernier"+1 RETURNING "dernier"`,
        );
        numA = `ATT-2032-${String(rows[0].dernier).padStart(4, "0")}`;
        await tA.query(`UPDATE "public"."Attestation" SET "statut"='DELIVREE', "numero"=$2, "delivreeLe"=now(), "updatedAt"=now() WHERE "id"=$1`, [dem.id, numA]);
      } else {
        await tA.query(`UPDATE "public"."Attestation" SET "statut"='REFUSEE', "motifRefus"='Pièce manquante', "updatedAt"=now() WHERE "id"=$1`, [dem.id]);
      }
      const b = delivrerAttestation(prisma, { employeeId: a, type: "TRAVAIL", parId: directionId, maintenant: new Date("2032-01-10T10:00:00Z") });
      await new Promise((r) => setTimeout(r, 600));
      await tA.query("COMMIT");
      return { a, dem, numA, rb: await b };
    } finally {
      await tA.end();
    }
  }

  it("A a DÉLIVRÉ la demande : B ne l'écrase pas, il délivre une attestation DISTINCTE", async () => {
    const { a, dem, numA, rb } = await course("DELIVREE");
    if (!rb.ok) throw new Error(rb.motif);
    expect(rb.id).not.toBe(dem.id);
    expect(rb.numero).not.toBe(numA);
    expect(await prisma.attestation.findUniqueOrThrow({ where: { id: dem.id } })).toEqual(expect.objectContaining({ statut: "DELIVREE", numero: numA }));
    expect(await prisma.attestation.count({ where: { employeeId: a, statut: "DELIVREE" } })).toBe(2);
  });

  it("A a REFUSÉ la demande : elle reste REFUSÉE, B délivre une attestation distincte", async () => {
    const { dem, rb } = await course("REFUSEE");
    if (!rb.ok) throw new Error(rb.motif);
    expect(rb.id).not.toBe(dem.id);
    expect(await prisma.attestation.findUniqueOrThrow({ where: { id: dem.id } })).toEqual(
      expect.objectContaining({ statut: "REFUSEE", numero: null, motifRefus: "Pièce manquante" }),
    );
  });
});

describe("« à sa demande » dans l'instantané", () => {
  it("vrai pour une demande du salarié, faux pour une délivrance directe", async () => {
    const a = await salarie();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { employeeId: a } })).id;
    const d = await demanderAttestation(prisma, { employeeId: a, type: "TRAVAIL", motif: null, parId: userId });
    if (!d.ok) throw new Error(d.motif);
    await delivrer({ attestationId: d.id });
    const direct = await delivrer({ employeeId: a, type: "TRAVAIL" });
    if (!direct.ok) throw new Error(direct.motif);
    const [x, y] = await Promise.all([d.id, direct.id].map((id) => prisma.attestation.findUniqueOrThrow({ where: { id } })));
    expect((x.donnees as { aSaDemande?: boolean }).aSaDemande).toBe(true);
    expect((y.donnees as { aSaDemande?: boolean }).aSaDemande).toBe(false);
  });
});

describe("libre-service : l'attestation de salaire du mois, obtenue par le salarié (décision du 2026-09-28)", () => {
  const libre = (employeeId: string, db: PrismaClient = prisma, maintenant = MAINTENANT) =>
    prisma.user.findUniqueOrThrow({ where: { employeeId } }).then((u) =>
      delivrerAttestation(db, { employeeId, type: "SALAIRE", parId: u.id, libreService: true, maintenant }));

  it("délivrée tout de suite : numéro, instantané de la dernière paie validée, exemplaire figé, journal ; la Direction est informée", async () => {
    const a = await salarie();
    await paie(a, 5, 2026, "PAYE", 280, 320);
    const juillet = await paie(a, 7, 2026, "VALIDE", 300, 350);
    await paie(a, 8, 2026, "PAS_VALIDE", 999, 999); // brouillon : ignoré
    const r = await libre(a);
    if (!r.ok) throw new Error(r.motif);
    expect(r.existante).toBeUndefined();
    const att = await prisma.attestation.findUniqueOrThrow({ where: { id: r.id } });
    expect(att).toEqual(expect.objectContaining({ statut: "DELIVREE", type: "SALAIRE", numero: r.numero, payrollLineId: juillet.id }));
    expect(att.donnees).toEqual(expect.objectContaining({ libreService: true, aSaDemande: true, salaire: expect.objectContaining({ mois: 7, annee: 2026, netUSD: "300.00" }) }));
    expect(F.figees).toHaveLength(1);
    const j = await prisma.journalAudit.findFirstOrThrow({ where: { entite: "Attestation", entiteId: r.id, champ: "delivrance" } });
    expect(j.nouvelleValeur).toBe(`${r.numero} (libre-service)`);
    expect(N.direction).toEqual([expect.stringContaining(`a obtenu son attestation de salaire ${r.numero} en libre-service`)]);
    expect(N.salarie, "le salarié est l'auteur : pas de notification à lui-même").toEqual([]);
  });

  it("second clic : LA MÊME attestation, sans nouveau numéro, rien d'écrit", async () => {
    const a = await salarie();
    await paie(a, 7, 2026, "VALIDE");
    const r1 = await libre(a);
    const avant = await prisma.compteurAttestation.findMany();
    const r2 = await libre(a);
    if (!r1.ok || !r2.ok) throw new Error("refus inattendu");
    expect(r2).toEqual({ ok: true, id: r1.id, numero: r1.numero, existante: true });
    expect(await prisma.compteurAttestation.findMany()).toEqual(avant);
    expect(await prisma.attestation.count({ where: { employeeId: a } })).toBe(1);
  });

  it("double clic SIMULTANÉ (deux connexions) : une seule attestation, un seul numéro", async () => {
    const a = await salarie();
    await paie(a, 7, 2026, "VALIDE");
    const autre = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    try {
      const rs = await Promise.all([libre(a), libre(a, autre), libre(a), libre(a, autre)]);
      const numeros = new Set(rs.map((r) => (r.ok ? r.numero : r.motif)));
      expect(numeros.size).toBe(1);
      expect(rs.filter((r) => r.ok && !r.existante)).toHaveLength(1);
      expect(await prisma.attestation.count({ where: { employeeId: a } })).toBe(1);
    } finally {
      await autre.$disconnect();
    }
  });

  it("nouvelle paie validée (mois suivant) → nouvelle attestation ; paie du même mois revue → nouvelle aussi", async () => {
    const a = await salarie();
    const juillet = await paie(a, 7, 2026, "VALIDE", 300, 350);
    const r1 = await libre(a);
    await prisma.payrollLine.update({ where: { id: juillet.id }, data: { salBrutUSD: 400 } }); // rouverte, corrigée, revalidée
    const r2 = await libre(a);
    await paie(a, 8, 2026, "VALIDE", 310, 360);
    const r3 = await libre(a);
    const ids = [r1, r2, r3].map((r) => (r.ok ? r.id : r.motif));
    expect(new Set(ids).size).toBe(3);
  });

  it("aucune paie validée : refus lisible, rien d'écrit, la Direction n'est pas dérangée", async () => {
    const a = await salarie();
    await paie(a, 7, 2026, "PAS_VALIDE");
    expect(await libre(a)).toEqual({ ok: false, motif: "Aucune paie validée : l'attestation de salaire reprend la dernière paie validée ou payée." });
    expect(await prisma.attestation.count({ where: { employeeId: a } })).toBe(0);
    expect(N.direction).toEqual([]);
  });

  it("une demande de salaire en attente n'est ni reprise ni refusée par le clic du salarié", async () => {
    const a = await salarie();
    const u = await prisma.user.findUniqueOrThrow({ where: { employeeId: a } });
    const dem = await prisma.attestation.create({ data: { employeeId: a, type: "SALAIRE", demandeParId: u.id } });
    expect((await libre(a)).ok).toBe(false); // pas de paie validée
    expect((await prisma.attestation.findUniqueOrThrow({ where: { id: dem.id } })).statut).toBe("DEMANDEE");
  });

  it("seule l'attestation de salaire s'obtient en libre-service", async () => {
    const a = await salarie();
    expect(await delivrerAttestation(prisma, { employeeId: a, type: "TRAVAIL", parId: directionId, libreService: true })).toEqual({
      ok: false,
      motif: "Seule l'attestation de salaire s'obtient en libre-service.",
    });
  });
});
