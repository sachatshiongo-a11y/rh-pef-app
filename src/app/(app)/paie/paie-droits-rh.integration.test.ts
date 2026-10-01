import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { Client } from "pg";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// « LA DIRECTION VALIDE, LA RH PAIE ENSUITE » (décision de Sacha du 2026-10-01), et la RH clôture une
// paie que la Direction a ENTIÈREMENT validée. Preuve par les VRAIES actions serveur appelées
// directement, comme le ferait un compte qui contourne l'écran : matrice rôle × geste (valider, payer,
// annuler un paiement, rouvrir, réinitialiser, clôturer), à l'unité ET en lot ; la RH ne paie jamais
// un bulletin non validé (même glissé dans un lot) ; jeton des montants affichés ; auteur réel des
// transitions ; notifications. Seule la session est simulée : `requireRole` applique la vraie liste.
// Les tests s'enchaînent sur une même base : l'ordre compte.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
const P = vi.hoisted(() => ({ push: vi.fn(async (..._a: unknown[]) => {}) }));
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
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
  requireModule: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: P.push }));

const { calculerPaieDuMois, changerStatutPaie, changerStatutEnLot, cloturerPaie, reinitialiserPaieDuMois } = await import("./actions");
const { jetonLigne } = await import("@/lib/paie-jeton");
const { MESSAGE_PAIEMENT_PERIME, MESSAGE_PAIEMENT_SANS_JETON, messageAttenteDirection } = await import("@/lib/paie-validation");
const { messageBulletinsAPayer, messageBulletinsPayes, messageClotureParRH, refAPayer } = await import("@/lib/paie-notifications");
const { totalVerseUSD } = await import("@/lib/paie-net");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let url = "";
let journee = "";
let runId = "";
const comptes = {} as Record<Role, { id: string; nom: string }>;
const ids = { ada: "", beatrice: "", clarisse: "", dieudonne: "", esther: "", fanny: "" };

const ROLES: Role[] = ["ADMIN", "MANAGER", "COMPTA", "VIEWER", "STOCK", "EMPLOYE"];
const AUTRES: Role[] = ["COMPTA", "VIEWER", "STOCK", "EMPLOYE"]; // ni Direction ni RH
const REFUS = "Accès refusé : rôle insuffisant.";

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const SAISI = new Date("2026-10-01T08:00:00Z");
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirection = (message: string) => `REDIRECT /paie?erreur=${encodeURIComponent(message)}`;
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois: 9, annee: 2026 } } });
const statut = async (employeeId: string) => (await ligne(employeeId)).statutPaiement;
const en = (role: Role) => { A.user = { ...A.user, id: comptes[role].id, nom: comptes[role].nom, role }; };
const transitions = () => prisma.transitionPaie.count();
const notifsDe = (role: Role) => prisma.notification.findMany({ where: { domaine: "RH", destinataireUserId: comptes[role].id }, orderBy: { createdAt: "asc" } });
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);

async function brigade(matricule: string, nom: string) {
  const id = (await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Brigade", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel: 300, heuresHebdomadaires: 45, heuresParJour: 9, enfants: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDD",
  } })).id;
  await prisma.planningCreneau.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, shiftId: journee })) });
  await prisma.attendance.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, code: "P", createdAt: SAISI, updatedAt: SAISI })) });
  await prisma.overtimeEntry.createMany({ data: joursOuvres().map((date) => ({ employeeId: id, date, heuresTravaillees: 9, createdAt: SAISI, updatedAt: SAISI })) });
  return id;
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; url = db.url; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: exercice.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  for (const role of ROLES) {
    const nom = role === "ADMIN" ? "Direction" : role === "MANAGER" ? "Responsable RH" : `Compte ${role}`;
    comptes[role] = { id: (await prisma.user.create({ data: { email: `${role.toLowerCase()}@pef.cd`, nom, role } })).id, nom };
  }
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  ids.ada = await brigade("AK01-PEF", "Ada Kalala");
  ids.beatrice = await brigade("BM01-PEF", "Béatrice Mbuyi");
  ids.clarisse = await brigade("CN01-PEF", "Clarisse Nsimba");
  ids.dieudonne = await brigade("DT01-PEF", "Dieudonné Tshala");
  ids.esther = await brigade("EM01-PEF", "Esther Mwamba");
  ids.fanny = await brigade("FL01-PEF", "Fanny Lukusa");
  en("ADMIN");
  await calculerPaieDuMois();
  runId = (await prisma.payrollRun.findUniqueOrThrow({ where: { mois_annee: { mois: 9, annee: 2026 } } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("valider : la Direction seule", () => {
  it.each([...AUTRES, "MANAGER" as Role])("%s : refusé à l'unité et en lot, rien d'écrit", async (role) => {
    const avant = await transitions();
    const a = await ligne(ids.ada);
    const b = await ligne(ids.beatrice);
    en(role);
    await expect(changerStatutPaie(a.id, fd({ versStatut: "VALIDE", jeton: jetonLigne(a) }))).rejects.toThrow(REFUS);
    expect(await changerStatutEnLot([a.id, b.id], "VALIDE", null, { [a.id]: jetonLigne(a), [b.id]: jetonLigne(b) })).toEqual({ erreur: REFUS });
    expect([await statut(ids.ada), await statut(ids.beatrice)]).toEqual(["PAS_VALIDE", "PAS_VALIDE"]);
    expect(await transitions()).toBe(avant);
  });

  it("ADMIN : valide à l'unité puis en lot ; la RH reçoit UNE notification « à payer » (remplacée, pas empilée)", async () => {
    en("ADMIN");
    P.push.mockClear();
    const a = await ligne(ids.ada);
    await changerStatutPaie(a.id, fd({ versStatut: "VALIDE", jeton: jetonLigne(a) }));
    expect((await notifsDe("MANAGER")).map((n) => n.message)).toEqual([messageBulletinsAPayer(1, 9, 2026, 1)]);
    const lot = await Promise.all([ids.beatrice, ids.clarisse, ids.dieudonne].map(ligne));
    expect(await changerStatutEnLot(lot.map((l) => l.id), "VALIDE", null, Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])))).toBe(3);
    const rh = await notifsDe("MANAGER");
    expect(rh.map((n) => [n.message, n.lien, n.refId, n.lu])).toEqual([[messageBulletinsAPayer(3, 9, 2026, 4), "/a-valider", refAPayer(runId), false]]);
    expect(rh[0].message).toBe("3 bulletins de septembre 2026 validés — à payer (4 en attente de paiement)");
    // L'auteur n'est pas notifié de son propre geste ; aucun autre compte non plus.
    for (const role of ROLES.filter((r) => r !== "MANAGER")) expect(await notifsDe(role)).toEqual([]);
    expect(P.push).toHaveBeenCalledWith([comptes.MANAGER.id], expect.objectContaining({ url: "/a-valider" }));
    // Transitions : la Direction en est l'auteur.
    expect(await prisma.transitionPaie.findMany({ where: { versStatut: "VALIDE" }, select: { userId: true } })).toEqual(Array(4).fill({ userId: comptes.ADMIN.id }));
  });
});

describe("payer : la Direction ET la RH, depuis « Validé » seulement", () => {
  it.each(AUTRES)("%s : refusé à l'unité et en lot", async (role) => {
    const avant = await transitions();
    const a = await ligne(ids.ada);
    en(role);
    await expect(changerStatutPaie(a.id, fd({ versStatut: "PAYE", jeton: jetonLigne(a) }))).rejects.toThrow(REFUS);
    expect(await changerStatutEnLot([a.id], "PAYE", null, { [a.id]: jetonLigne(a) })).toEqual({ erreur: REFUS });
    expect(await statut(ids.ada)).toBe("VALIDE");
    expect(await transitions()).toBe(avant);
  });

  it("RH : un bulletin NON validé ne se paie pas à l'unité (message lisible, rien d'écrit)", async () => {
    const avant = await transitions();
    const e = await ligne(ids.esther);
    en("MANAGER");
    await expect(changerStatutPaie(e.id, fd({ versStatut: "PAYE", jeton: jetonLigne(e) }))).rejects.toThrow(
      redirection("Seul un bulletin validé par la Direction peut être marqué payé : rechargez la page."),
    );
    expect(await statut(ids.esther)).toBe("PAS_VALIDE");
    expect(await transitions()).toBe(avant);
  });

  it("RH : sans les montants affichés (jeton), le paiement est refusé — à l'unité et en lot", async () => {
    const a = await ligne(ids.ada);
    en("MANAGER");
    await expect(changerStatutPaie(a.id, fd({ versStatut: "PAYE" }))).rejects.toThrow(redirection(MESSAGE_PAIEMENT_SANS_JETON));
    expect(await changerStatutEnLot([a.id], "PAYE")).toEqual({ erreur: MESSAGE_PAIEMENT_SANS_JETON });
    expect(await statut(ids.ada)).toBe("VALIDE");
  });

  it("RH paie à l'unité : auteur réel partout, mode choisi, la Direction est notifiée (date, total versé)", async () => {
    const a = await ligne(ids.ada);
    en("MANAGER");
    await changerStatutPaie(a.id, fd({ versStatut: "PAYE", jeton: jetonLigne(a), modePaiement: "MOBILE_MONEY" }));
    const apres = await ligne(ids.ada);
    expect([apres.statutPaiement, apres.payeParId, apres.modePaiement]).toEqual(["PAYE", comptes.MANAGER.id, "MOBILE_MONEY"]);
    expect(apres.datePaiement).not.toBeNull();
    const t = await prisma.transitionPaie.findFirstOrThrow({ where: { payrollLineId: a.id, versStatut: "PAYE" } });
    expect([t.deStatut, t.userId, t.modePaiement]).toEqual(["VALIDE", comptes.MANAGER.id, "MOBILE_MONEY"]);
    expect(await prisma.journalAudit.findFirst({ where: { entite: "PayrollLine", entiteId: a.id, nouvelleValeur: "PAYE" }, select: { userId: true } })).toEqual({ userId: comptes.MANAGER.id });
    expect((await notifsDe("ADMIN")).map((n) => n.message)).toEqual([messageBulletinsPayes(1, 9, 2026, apres.datePaiement!, totalVerseUSD(apres))]);
    expect((await notifsDe("ADMIN"))[0].message).toMatch(/^1 bulletin de septembre 2026 payé le \d\d\/\d\d\/2026 — [\d ]+,\d\d \$$/);
  });

  it("RH en lot : une ligne non validée glissée dans le lot est ignorée, jamais payée", async () => {
    const lot = await Promise.all([ids.beatrice, ids.clarisse, ids.esther].map(ligne));
    const esther = lot[2];
    en("MANAGER");
    expect(await changerStatutEnLot(lot.map((l) => l.id), "PAYE", "VIREMENT", Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])))).toBe(2);
    expect([await statut(ids.beatrice), await statut(ids.clarisse), await statut(ids.esther)]).toEqual(["PAYE", "PAYE", "PAS_VALIDE"]);
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: esther.id } })).toBe(0);
    const payees = await Promise.all([ids.beatrice, ids.clarisse].map(ligne));
    expect(payees.map((l) => [l.payeParId, l.modePaiement])).toEqual([[comptes.MANAGER.id, "VIREMENT"], [comptes.MANAGER.id, "VIREMENT"]]);
    const dir = await notifsDe("ADMIN");
    expect(dir.at(-1)!.message).toBe(messageBulletinsPayes(2, 9, 2026, payees[0].datePaiement!, payees.reduce((s, l) => s + totalVerseUSD(l), 0)));
    // Il reste Dieudonné à payer : le rappel « à payer » de la RH reste.
    expect((await notifsDe("MANAGER")).filter((n) => n.refId === refAPayer(runId))).toHaveLength(1);
  });

  it("jeton périmé : bulletin rouvert, recalculé et revalidé depuis l'affichage → paiement refusé (unité et lot)", async () => {
    const affiche = await ligne(ids.dieudonne);
    const jetonAffiche = jetonLigne(affiche); // ce que l'écran de la RH montre
    en("ADMIN");
    await changerStatutPaie(affiche.id, fd({ versStatut: "PAS_VALIDE" }));
    await prisma.prime.create({ data: { employeeId: ids.dieudonne, nom: "Prime", montantUSD: 30, mois: 9, annee: 2026 } });
    await calculerPaieDuMois();
    const recalculee = await ligne(ids.dieudonne);
    expect(recalculee.id).toBe(affiche.id);
    expect(jetonLigne(recalculee)).not.toBe(jetonAffiche);
    await changerStatutPaie(recalculee.id, fd({ versStatut: "VALIDE", jeton: jetonLigne(recalculee) }));

    en("MANAGER");
    await expect(changerStatutPaie(affiche.id, fd({ versStatut: "PAYE", jeton: jetonAffiche }))).rejects.toThrow(redirection(MESSAGE_PAIEMENT_PERIME));
    expect(await changerStatutEnLot([affiche.id], "PAYE", null, { [affiche.id]: jetonAffiche })).toEqual({ erreur: MESSAGE_PAIEMENT_PERIME });
    expect(await statut(ids.dieudonne)).toBe("VALIDE");
    // Page rechargée : les montants validés sous les yeux, le paiement passe.
    expect(await changerStatutEnLot([affiche.id], "PAYE", null, { [affiche.id]: jetonLigne(recalculee) })).toBe(1);
    // Plus rien à payer dans le mois : le rappel « à payer » non lu de la RH disparaît.
    expect((await notifsDe("MANAGER")).filter((n) => n.refId === refAPayer(runId))).toEqual([]);
  });
});

describe("retours en arrière et réinitialisation : la Direction seule", () => {
  it.each([...AUTRES, "MANAGER" as Role])("%s : ni annuler un paiement (unité, lot), ni réinitialiser", async (role) => {
    const avant = await transitions();
    const payee = await ligne(ids.beatrice); // PAYÉE
    en(role);
    await expect(changerStatutPaie(payee.id, fd({ versStatut: "VALIDE" }))).rejects.toThrow(REFUS);
    expect(await changerStatutEnLot([payee.id], "VALIDE")).toEqual({ erreur: REFUS });
    await expect(reinitialiserPaieDuMois()).rejects.toThrow(REFUS);
    expect(await prisma.payrollRun.count()).toBe(1);
    expect(await statut(ids.beatrice)).toBe("PAYE");
    expect(await transitions()).toBe(avant);
  });

  it("ADMIN : annule un paiement à l'unité (pas de « à payer » envoyé pour autant)", async () => {
    en("ADMIN");
    const avantRH = (await notifsDe("MANAGER")).length;
    await changerStatutPaie((await ligne(ids.ada)).id, fd({ versStatut: "VALIDE" }));
    expect(await statut(ids.ada)).toBe("VALIDE");
    expect(await notifsDe("MANAGER")).toHaveLength(avantRH);
  });

  it.each([...AUTRES, "MANAGER" as Role])("%s : ne rouvre pas un bulletin validé (unité, lot)", async (role) => {
    const avant = await transitions();
    const validee = await ligne(ids.ada); // VALIDÉE
    en(role);
    await expect(changerStatutPaie(validee.id, fd({ versStatut: "PAS_VALIDE" }))).rejects.toThrow(REFUS);
    expect(await changerStatutEnLot([validee.id], "PAS_VALIDE")).toEqual({ erreur: REFUS });
    expect(await statut(ids.ada)).toBe("VALIDE");
    expect(await transitions()).toBe(avant);
  });

  it("ADMIN : rouvre en lot ; jamais d'annulation de paiement en lot ; réinitialisation refusée par la règle métier, pas par le rôle", async () => {
    en("ADMIN");
    expect(await changerStatutEnLot([(await ligne(ids.ada)).id], "PAS_VALIDE")).toBe(1);
    expect(await statut(ids.ada)).toBe("PAS_VALIDE");
    expect(await changerStatutEnLot([(await ligne(ids.beatrice)).id], "VALIDE")).toBe(0); // en lot : jamais
    expect(await statut(ids.beatrice)).toBe("PAYE");
    await expect(reinitialiserPaieDuMois()).rejects.toThrow(/REDIRECT \/paie\?erreur=.*valid%C3%A9\(s\)%2Fpay%C3%A9\(s\)/);
  });
});

describe("clôturer : la Direction, et la RH seulement une paie entièrement validée", () => {
  it.each(AUTRES)("%s : refusé", async (role) => {
    en(role);
    await expect(cloturerPaie()).rejects.toThrow(REFUS);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).statut).toBe("BROUILLON");
  });

  it("RH : refusée tant qu'un bulletin attend la Direction — rien de validé, rien d'écrit", async () => {
    // Ada, Esther, Fanny : pas validées.
    const avant = await transitions();
    en("MANAGER");
    await expect(cloturerPaie()).rejects.toThrow(redirection(`Clôture refusée : ${messageAttenteDirection(3)}`));
    expect(messageAttenteDirection(3)).toBe("3 bulletins attendent encore la validation de la Direction : la RH ne clôture qu'une paie entièrement validée.");
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).statut).toBe("BROUILLON");
    expect(await transitions()).toBe(avant);
    expect([await statut(ids.ada), await statut(ids.esther), await statut(ids.fanny)]).toEqual(["PAS_VALIDE", "PAS_VALIDE", "PAS_VALIDE"]);
  });

  it("RH en concurrence avec une réouverture en cours : la clôture attend, lit « pas validé », refuse", async () => {
    en("ADMIN");
    const lot = await Promise.all([ids.ada, ids.esther, ids.fanny].map(ligne));
    expect(await changerStatutEnLot(lot.map((l) => l.id), "VALIDE", null, Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])))).toBe(3);
    const fanny = await ligne(ids.fanny);
    const externe = new Client({ connectionString: url });
    await externe.connect();
    let cloture: Promise<unknown> | undefined;
    try {
      // Une réouverture (Direction) en cours : la ligne est écrite, la transaction pas encore validée.
      await externe.query("BEGIN");
      await externe.query(`UPDATE "public"."PayrollLine" SET "statutPaiement" = 'PAS_VALIDE' WHERE "id" = $1`, [fanny.id]);
      let fini = false;
      en("MANAGER");
      cloture = cloturerPaie().then(() => null, (e: unknown) => e).finally(() => { fini = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(fini).toBe(false); // elle attend le verrou de la ligne
      await externe.query("COMMIT");
      expect(((await cloture) as Error).message).toBe(redirection(`Clôture refusée : ${messageAttenteDirection(1)}`));
    } finally {
      await externe.query("ROLLBACK").catch(() => {});
      await cloture;
      await externe.end();
    }
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).statut).toBe("BROUILLON");
    // La Direction revalide Fanny pour la suite.
    en("ADMIN");
    await changerStatutPaie(fanny.id, fd({ versStatut: "VALIDE" }));
  });

  it("RH : paie entièrement validée → fermée sans rien valider ; la Direction est notifiée une fois", async () => {
    const avant = await transitions();
    const avantDir = (await notifsDe("ADMIN")).length;
    en("MANAGER");
    await expect(cloturerPaie()).resolves.toBeUndefined();
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).statut).toBe("VALIDE");
    expect(await transitions()).toBe(avant); // aucun bulletin validé par la RH
    expect(await prisma.transitionPaie.count({ where: { userId: comptes.MANAGER.id, versStatut: { not: "PAYE" } } })).toBe(0);
    const dir = await notifsDe("ADMIN");
    expect(dir).toHaveLength(avantDir + 1);
    expect(dir.at(-1)!.message).toBe(messageClotureParRH(9, 2026, "Responsable RH", 0));
    expect(dir.at(-1)!.message).toBe("Paie de septembre 2026 clôturée par Responsable RH");
    // Déjà close : une seconde clôture ne dit rien de plus.
    await cloturerPaie();
    expect(await notifsDe("ADMIN")).toHaveLength(avantDir + 1);
  });

  it("ADMIN : comportement inchangé — la clôture valide les « pas validé » restants ; la RH apprend qu'ils sont à payer", async () => {
    en("ADMIN");
    const ada = await ligne(ids.ada);
    await changerStatutPaie(ada.id, fd({ versStatut: "PAS_VALIDE" })); // rouverte après la clôture
    await prisma.notification.deleteMany({ where: { destinataireUserId: comptes.MANAGER.id } });
    await cloturerPaie();
    expect(await statut(ids.ada)).toBe("VALIDE");
    expect((await prisma.transitionPaie.findFirstOrThrow({ where: { payrollLineId: ada.id }, orderBy: { date: "desc" } })).userId).toBe(comptes.ADMIN.id);
    // Validés restant à payer : Ada, Esther, Fanny.
    expect((await notifsDe("MANAGER")).map((n) => n.message)).toEqual([messageBulletinsAPayer(1, 9, 2026, 3)]);
  });
});

describe("une notification en échec n'annule jamais un paiement enregistré", () => {
  it("push en panne pendant le paiement par la RH : aucune erreur, bulletin payé", async () => {
    P.push.mockRejectedValueOnce(new Error("service push indisponible"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await ligne(ids.esther);
    en("MANAGER");
    await expect(changerStatutPaie(e.id, fd({ versStatut: "PAYE", jeton: jetonLigne(e) }))).resolves.toBeUndefined();
    expect(await statut(ids.esther)).toBe("PAYE");
    expect(erreur).toHaveBeenCalled();
    erreur.mockRestore();
  });
});
