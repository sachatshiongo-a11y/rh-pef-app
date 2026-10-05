import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// DATE DE VERSEMENT DES SALAIRES (demande de la Direction, 2026-10-05) : « Marquer payé » (à l'unité,
// en lot) date le versement du jour CHOISI, plus du clic. Preuve par les VRAIES actions serveur :
// date choisie stockée (date pure, minuit UTC) et annoncée à la Direction ; absente = aujourd'hui à
// Kinshasa ; illisible, future, ou avant le 1er du mois de la paie = refus, rien de payé ; lot tout ou
// rien (une seule paie trop récente refuse le lot entier). Seule la session est simulée.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
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
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { calculerPaieDuMois, changerStatutPaie, changerStatutEnLot } = await import("./actions");
const { jetonDeLigneLue: jetonLigne } = await import("@/lib/paie-jeton");
const { jourKinshasaISO } = await import("@/lib/date-paiement");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let journee = "";
const comptes = {} as Record<Role, { id: string; nom: string }>;
const ids = { ada: "", beatrice: "", clarisse: "", dieudonne: "" };

const d = (n: number) => new Date(Date.UTC(2026, 8, n));
const SAISI = new Date("2026-10-01T08:00:00Z");
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirection = (message: string) => `REDIRECT /paie?erreur=${encodeURIComponent(message)}`;
const ligne = (employeeId: string) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId }, include: { payrollRun: { select: { tauxChangeUtilise: true } } } });
const statut = async (employeeId: string) => (await ligne(employeeId)).statutPaiement;
const en = (role: Role) => { A.user = { ...A.user, id: comptes[role].id, nom: comptes[role].nom, role }; };
const transitionsPayees = () => prisma.transitionPaie.count({ where: { versStatut: "PAYE" } });
const notifsDirection = () => prisma.notification.findMany({ where: { domaine: "RH", destinataireUserId: comptes.ADMIN.id }, orderBy: { createdAt: "asc" } });
const joursOuvres = () => Array.from({ length: 30 }, (_, i) => d(i + 1)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);
const minuitUTC = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
function demain(): string { const x = minuitUTC(jourKinshasaISO()); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }

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
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: exercice.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  for (const role of ["ADMIN", "MANAGER"] as Role[]) {
    const nom = role === "ADMIN" ? "Direction" : "Responsable RH";
    comptes[role] = { id: (await prisma.user.create({ data: { email: `${role.toLowerCase()}@pef.cd`, nom, role } })).id, nom };
  }
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id;
  ids.ada = await brigade("AK01-PEF", "Ada Kalala");
  ids.beatrice = await brigade("BM01-PEF", "Béatrice Mbuyi");
  ids.clarisse = await brigade("CN01-PEF", "Clarisse Nsimba");
  ids.dieudonne = await brigade("DT01-PEF", "Dieudonné Tshala");
  en("ADMIN");
  await calculerPaieDuMois();
  // La Direction valide les quatre bulletins : il ne reste qu'à les payer.
  const lot = await Promise.all(Object.values(ids).map(ligne));
  await changerStatutEnLot(lot.map((l) => l.id), "VALIDE", null, Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])));
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("date de versement — à l'unité", () => {
  it("la date choisie est stockée (jour civil, minuit UTC) et annoncée à la Direction, pas l'heure du clic", async () => {
    const a = await ligne(ids.ada);
    en("MANAGER");
    await changerStatutPaie(a.id, fd({ versStatut: "PAYE", jeton: jetonLigne(a), dateVersement: "2026-09-15" }));
    const apres = await ligne(ids.ada);
    expect(apres.statutPaiement).toBe("PAYE");
    expect(apres.datePaiement?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect((await notifsDirection()).at(-1)!.message).toMatch(/^1 bulletin de septembre 2026 payé le 15\/09\/2026 — /);
  });

  it("sans date (compte qui contourne l'écran) : aujourd'hui, jour civil de Kinshasa", async () => {
    const b = await ligne(ids.beatrice);
    en("ADMIN");
    await changerStatutPaie(b.id, fd({ versStatut: "PAYE", jeton: jetonLigne(b) }));
    expect((await ligne(ids.beatrice)).datePaiement?.toISOString()).toBe(`${jourKinshasaISO()}T00:00:00.000Z`);
  });

  it("date future, illisible ou avant le 1er du mois de la paie : refus lisible, rien de payé ni tracé", async () => {
    const c = await ligne(ids.clarisse);
    const avant = await transitionsPayees();
    en("MANAGER");
    const jeton = jetonLigne(c);
    await expect(changerStatutPaie(c.id, fd({ versStatut: "PAYE", jeton, dateVersement: demain() }))).rejects.toThrow(redirection("La date de versement ne peut pas être dans le futur."));
    await expect(changerStatutPaie(c.id, fd({ versStatut: "PAYE", jeton, dateVersement: "30/09/2026" }))).rejects.toThrow(redirection("Date de versement invalide."));
    await expect(changerStatutPaie(c.id, fd({ versStatut: "PAYE", jeton, dateVersement: "2026-08-31" }))).rejects.toThrow(
      redirection("La date de versement (31/08/2026) ne peut pas être antérieure au 1er jour du mois de la paie (septembre 2026)."),
    );
    const apres = await ligne(ids.clarisse);
    expect([apres.statutPaiement, apres.datePaiement, apres.payeParId]).toEqual(["VALIDE", null, null]);
    expect(await transitionsPayees()).toBe(avant);
  });

  it("le 1er du mois de la paie est accepté", async () => {
    const c = await ligne(ids.clarisse);
    en("MANAGER");
    await changerStatutPaie(c.id, fd({ versStatut: "PAYE", jeton: jetonLigne(c), dateVersement: "2026-09-01" }));
    expect((await ligne(ids.clarisse)).datePaiement?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("date de versement — en lot (tout ou rien)", () => {
  it("date future : le lot entier est refusé avant toute écriture", async () => {
    const lot = [await ligne(ids.dieudonne)];
    const avant = await transitionsPayees();
    en("MANAGER");
    expect(await changerStatutEnLot(lot.map((l) => l.id), "PAYE", null, Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])), demain()))
      .toEqual({ erreur: "La date de versement ne peut pas être dans le futur." });
    expect(await statut(ids.dieudonne)).toBe("VALIDE");
    expect(await transitionsPayees()).toBe(avant);
  });

  it("une seule paie d'un mois pas encore commencé refuse TOUT le lot, la ligne déjà traitée est annulée", async () => {
    // Clarisse et Béatrice sont payées : on remet deux lignes « Validé » — Dieudonné (septembre) et une ligne d'une paie de décembre 2099.
    const run = await prisma.payrollRun.create({ data: { mois: 12, annee: 2099, statut: "BROUILLON", tauxChangeUtilise: 2300 } });
    await prisma.payrollLine.update({ where: { id: (await ligne(ids.dieudonne)).id }, data: { statutPaiement: "VALIDE" } });
    const reportee = await ligne(ids.clarisse);
    await prisma.payrollLine.update({ where: { id: reportee.id }, data: { statutPaiement: "VALIDE", datePaiement: null, payeParId: null, payrollRunId: run.id } });
    const lot = [await ligne(ids.dieudonne), await ligne(ids.clarisse)]; // Dieudonné d'abord : il passerait, puis Clarisse est refusée
    const avant = await transitionsPayees();
    en("ADMIN");
    const r = await changerStatutEnLot(lot.map((l) => l.id), "PAYE", null, Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])), "2026-09-15");
    expect(r).toEqual({ erreur: "Clarisse Nsimba : La date de versement (15/09/2026) ne peut pas être antérieure au 1er jour du mois de la paie (décembre 2099)." });
    expect([await statut(ids.dieudonne), await statut(ids.clarisse)]).toEqual(["VALIDE", "VALIDE"]);
    expect((await ligne(ids.dieudonne)).datePaiement).toBeNull();
    expect(await transitionsPayees()).toBe(avant);
  });

  it("date choisie : toutes les lignes du lot portent le même jour, annoncé à la Direction", async () => {
    // Clarisse (paie de décembre 2099) est écartée du lot : on ne paie ici que la paie de septembre.
    const lot = [await ligne(ids.dieudonne)];
    en("MANAGER");
    expect(await changerStatutEnLot(lot.map((l) => l.id), "PAYE", "VIREMENT", Object.fromEntries(lot.map((l) => [l.id, jetonLigne(l)])), "2026-09-28")).toBe(1);
    const apres = await ligne(ids.dieudonne);
    expect([apres.statutPaiement, apres.datePaiement?.toISOString(), apres.modePaiement]).toEqual(["PAYE", "2026-09-28T00:00:00.000Z", "VIREMENT"]);
    expect((await notifsDirection()).at(-1)!.message).toMatch(/^1 bulletin de septembre 2026 payé le 28\/09\/2026 — /);
  });
});
