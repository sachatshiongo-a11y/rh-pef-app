import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Les ACTIONS du planning passent toutes par `ecrireCreneaux` : refus propre quand la paie du
// salarié est validée ou payée pour ce mois, et trace sinon (décision Direction 3, 2026-09-23).
// Les tests s'enchaînent sur une même base : l'ordre compte.
// `avantTransaction` : simule une écriture CONCURRENTE, posée entre la lecture du planning par la
// génération et sa transaction d'écriture (une seule fois, puis le crochet se retire).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, avantTransaction: null as null | (() => Promise<unknown>) }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      if (p === "$transaction" && H.avantTransaction) {
        const avant = H.avantTransaction;
        H.avantTransaction = null;
        return async (...a: unknown[]) => { await avant(); return (H.client.$transaction as (...x: unknown[]) => unknown)(...a); };
      }
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { saisirCreneau, saisirCreneauxEnLot, genererPlanningAuto, approuverEchange, approuverChangementShift } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let valide = "";
let ouvert = "";
let ancienne = "";
let matin = "";
let soir = "";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const FIGE_MARTINE = "Paie validée ou payée : Martine Mutombo (septembre 2026) — ses créneaux de ce mois n'ont pas été touchés";
const MESSAGE = "Planning verrouillé : paie validée ou payée pour Martine Mutombo (septembre 2026). Rouvrir la ligne de paie avant de modifier ce planning.";
const creneau = (employeeId: string, iso: string) =>
  prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId, date: d(iso) } } });
const journal = (employeeId: string, iso: string) =>
  prisma.journalAudit.findMany({ where: { entite: "PlanningCreneau", entiteId: `${employeeId}|${iso}` }, orderBy: { date: "asc" } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE" as const, salaireMensuel: 200, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0, heuresHebdomadaires: 48 };
  valide = (await prisma.employee.create({ data: { ...base, matricule: "VA01-PEF", nom: "Martine Mutombo" } })).id;
  ouvert = (await prisma.employee.create({ data: { ...base, matricule: "OU01-PEF", nom: "Rachel Lunda" } })).id;
  // Partie fin septembre, paie PAYÉE : hors génération (inactive) mais ses créneaux restent protégés.
  ancienne = (await prisma.employee.create({ data: { ...base, matricule: "AN01-PEF", nom: "Esther Ngalula", actif: false } })).id;
  matin = (await prisma.shift.create({ data: { nom: "Matin", heureDebut: "08:00", heureFin: "16:00" } })).id;
  soir = (await prisma.shift.create({ data: { nom: "Soir", heureDebut: "16:00", heureFin: "22:00" } })).id;
  // Modèle du lundi pour les deux actives : la génération pose un créneau chaque lundi.
  await prisma.planningModele.createMany({ data: [valide, ouvert].map((employeeId) => ({ employeeId, jour: 1, semaine: 0, shiftId: matin })) });
  const run = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2300 } });
  const montants = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: valide, statutPaiement: "VALIDE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: ancienne, statutPaiement: "PAYE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: ouvert, statutPaiement: "PAS_VALIDE" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("saisie unitaire et en lot", () => {
  it("saisirCreneau : mois validé → erreur lisible, rien d'écrit", async () => {
    expect(await saisirCreneau(valide, "2026-09-10", matin)).toEqual({ erreur: MESSAGE });
    expect(await prisma.planningCreneau.count({ where: { employeeId: valide } })).toBe(0);
    expect(await journal(valide, "2026-09-10")).toHaveLength(0);
  });

  it("saisirCreneau : mois ouvert → écrit et journalisé au nom de l'utilisateur", async () => {
    expect(await saisirCreneau(ouvert, "2026-09-10", matin)).toEqual({});
    const j = await journal(ouvert, "2026-09-10");
    expect(j.map((e) => [e.ancienneValeur, e.nouvelleValeur, e.userId])).toEqual([[null, matin, A.user.id]]);
  });

  it("saisirCreneau : le même shift sur un créneau ✨ généré retire le marqueur, sans entrée de journal", async () => {
    await prisma.planningCreneau.create({ data: { employeeId: ouvert, date: d("2026-09-21"), shiftId: matin, genereAuto: true } });
    expect(await saisirCreneau(ouvert, "2026-09-21", matin)).toEqual({});
    expect((await creneau(ouvert, "2026-09-21"))?.genereAuto).toBe(false);
    expect(await journal(ouvert, "2026-09-21")).toHaveLength(0);
  });

  it("saisirCreneauxEnLot : un seul salarié verrouillé → tout le lot refusé", async () => {
    expect(await saisirCreneauxEnLot([
      { employeeId: ouvert, dateIso: "2026-09-11", shiftId: matin },
      { employeeId: valide, dateIso: "2026-09-11", shiftId: matin },
    ])).toEqual({ erreur: MESSAGE });
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-11") } })).toBe(0);
  });

  it("saisirCreneauxEnLot : lot ouvert → pose et efface, une entrée de journal par créneau changé", async () => {
    expect(await saisirCreneauxEnLot([
      { employeeId: ouvert, dateIso: "2026-09-11", shiftId: soir },
      { employeeId: ouvert, dateIso: "2026-09-10", shiftId: "" },
    ])).toEqual({});
    expect((await creneau(ouvert, "2026-09-11"))?.shiftId).toBe(soir);
    expect(await creneau(ouvert, "2026-09-10")).toBeNull();
    expect((await journal(ouvert, "2026-09-10")).map((e) => [e.ancienneValeur, e.nouvelleValeur])).toEqual([[null, matin], [matin, null]]);
  });
});

describe("génération automatique", () => {
  it("un salarié verrouillé ce mois-là → son jour n'est pas posé, son mois est nommé ; les autres sont générés", async () => {
    const r = await genererPlanningAuto("2026-09-14", "2026-09-14", fd({ modeles: "on" }));
    expect(r.erreur).toBeUndefined();
    expect(r.salariesIgnores).toBe(FIGE_MARTINE);
    expect(r.crees).toBe(1);
    expect(await creneau(valide, "2026-09-14")).toBeNull();
    expect((await creneau(ouvert, "2026-09-14"))?.genereAuto).toBe(true);
    expect(await journal(ouvert, "2026-09-14")).toHaveLength(1);
  });

  it("le rapport de couverture dit vrai : un salarié verrouillé n'est pas compté comme couvrant un besoin", async () => {
    // Besoin : 2 serveurs le lundi matin. Le jour de Martine (septembre verrouillé) est interdit
    // DANS le moteur : il n'en reste qu'une, le trou est annoncé. Retirée seulement à l'écriture,
    // le moteur l'aurait posée et le rapport aurait affiché « tous les besoins couverts ».
    const besoin = await prisma.besoinShift.create({ data: { shiftId: matin, poste: "Serveur", jourSemaine: 1, nombreRequis: 2 } });
    try {
      const r = await genererPlanningAuto("2026-09-28", "2026-09-28", fd({}));
      expect(r.salariesIgnores).toBe(FIGE_MARTINE);
      expect(r.trous.reduce((t, x) => t + x.manque, 0)).toBe(1);
      expect((await creneau(ouvert, "2026-09-28"))?.shiftId).toBe(matin);
      expect(await creneau(valide, "2026-09-28")).toBeNull();
    } finally {
      await prisma.besoinShift.delete({ where: { id: besoin.id } });
    }
  });

  it("« écraser » : efface les créneaux ouverts de la période, jamais ceux d'une paie verrouillée (même d'une salariée partie)", async () => {
    await prisma.planningCreneau.createMany({ data: [valide, ouvert, ancienne].map((employeeId) => ({ employeeId, date: d("2026-09-15"), shiftId: soir })) });
    const r = await genererPlanningAuto("2026-09-14", "2026-09-15", fd({ modeles: "on", ecraser: "on" }));
    expect(r.erreur).toBeUndefined();
    expect(r.salariesIgnores).toBe(
      "Paie validée ou payée : Esther Ngalula (septembre 2026), Martine Mutombo (septembre 2026) — leurs créneaux de ce mois n'ont pas été touchés",
    );
    expect(await creneau(ouvert, "2026-09-15")).toBeNull();
    expect((await creneau(valide, "2026-09-15"))?.shiftId).toBe(soir);
    expect((await creneau(ancienne, "2026-09-15"))?.shiftId).toBe(soir);
    // Le lundi, déjà au bon shift : rien de réécrit, toujours une seule entrée de journal.
    expect(await journal(ouvert, "2026-09-14")).toHaveLength(1);
    expect((await journal(ouvert, "2026-09-15")).map((e) => [e.ancienneValeur, e.nouvelleValeur])).toEqual([[soir, null]]);
  });

  it("période libre → créneaux ✨ journalisés", async () => {
    const r = await genererPlanningAuto("2026-10-05", "2026-10-05", fd({ modeles: "on" }));
    expect(r.erreur).toBeUndefined();
    expect(r.salariesIgnores).toBeUndefined();
    const c = await prisma.planningCreneau.findMany({ where: { date: d("2026-10-05") } });
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.genereAuto)).toBe(true);
    expect(await prisma.journalAudit.count({ where: { entite: "PlanningCreneau", entiteId: { endsWith: "|2026-10-05" } } })).toBe(2);
  });

  it("mode normal : un créneau existant n'est pas touché (équivalent de skipDuplicates)", async () => {
    await prisma.planningCreneau.create({ data: { employeeId: ouvert, date: d("2026-10-12"), shiftId: soir } });
    const r = await genererPlanningAuto("2026-10-12", "2026-10-12", fd({ modeles: "on" }));
    expect(r.crees).toBe(1);
    expect(await creneau(ouvert, "2026-10-12")).toMatchObject({ shiftId: soir, genereAuto: false });
    expect(await journal(ouvert, "2026-10-12")).toHaveLength(0);
    expect((await creneau(valide, "2026-10-12"))?.shiftId).toBe(matin);
  });

  it("« écraser » : un jour à la fois effacé et reposé = UNE opération (la pose), une entrée de journal", async () => {
    const r = await genererPlanningAuto("2026-10-12", "2026-10-12", fd({ modeles: "on", ecraser: "on" }));
    expect(r.erreur).toBeUndefined();
    // Une pose : celle de Rachel. Martine, déjà au bon shift, n'est ni réécrite ni comptée.
    expect(r.crees).toBe(1);
    expect(await creneau(ouvert, "2026-10-12")).toMatchObject({ shiftId: matin, genereAuto: true });
    expect((await journal(ouvert, "2026-10-12")).map((e) => [e.ancienneValeur, e.nouvelleValeur])).toEqual([[soir, matin]]);
    expect(await journal(valide, "2026-10-12")).toHaveLength(1); // déjà au bon shift : pas réécrit
  });
});

describe("génération automatique — semaine à cheval sur un mois verrouillé", () => {
  it("28/09 → 04/10, septembre validé pour Martine : planifiée du 1er au 4 octobre, septembre intact et non journalisé", async () => {
    // Ses créneaux de septembre (posés avant la validation) : lundi 28 et mardi 29, au soir (6 h).
    await prisma.planningCreneau.createMany({ data: ["2026-09-28", "2026-09-29"].map((j) => ({ employeeId: valide, date: d(j), shiftId: soir })) });
    const sp = await prisma.shiftPoste.create({ data: { poste: "Serveur", shiftId: matin, ordre: 0 } });
    try {
      const f = fd({ completer: "on" });
      for (const j of [0, 1, 2, 3, 4, 5, 6]) f.append("jours", String(j));
      const r = await genererPlanningAuto("2026-09-28", "2026-10-04", f);
      expect(r.erreur).toBeUndefined();
      expect(r.salariesIgnores).toBe(FIGE_MARTINE);
      for (const j of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]) {
        expect(await creneau(valide, j)).toMatchObject({ shiftId: matin, genereAuto: true });
        expect(await journal(valide, j)).toHaveLength(1);
      }
      for (const j of ["2026-09-28", "2026-09-29"]) {
        expect(await creneau(valide, j)).toMatchObject({ shiftId: soir, genereAuto: false });
        expect(await journal(valide, j)).toHaveLength(0);
      }
      expect(await creneau(valide, "2026-09-30")).toBeNull();
      expect(await journal(valide, "2026-09-30")).toHaveLength(0);
    } finally {
      await prisma.shiftPoste.delete({ where: { id: sp.id } });
    }
  });

  it("« écraser » avec septembre validé : les créneaux de Martine restent, et la couverture de ces jours les compte", async () => {
    // Mardi 22/09 : Martine au matin (septembre validé). Besoin : 1 serveur le mardi matin. Il est
    // déjà couvert par elle : Rachel ne doit pas être posée en plus (elle serait payée pour rien).
    await prisma.planningCreneau.create({ data: { employeeId: valide, date: d("2026-09-22"), shiftId: matin } });
    const besoin = await prisma.besoinShift.create({ data: { shiftId: matin, poste: "Serveur", jourSemaine: 2, nombreRequis: 1 } });
    try {
      const r = await genererPlanningAuto("2026-09-22", "2026-09-22", fd({ ecraser: "on" }));
      expect(r.erreur).toBeUndefined();
      expect(r.salariesIgnores).toBe(FIGE_MARTINE);
      expect(r.trous).toEqual([]);
      expect(r.crees).toBe(0);
      expect(await creneau(ouvert, "2026-09-22")).toBeNull();
      expect(await creneau(valide, "2026-09-22")).toMatchObject({ shiftId: matin, genereAuto: false });
      expect(await journal(valide, "2026-09-22")).toHaveLength(0);
    } finally {
      await prisma.besoinShift.delete({ where: { id: besoin.id } });
    }
  });
});

describe("génération automatique — créneau posé pendant la génération (course)", () => {
  it("mode normal : le créneau posé entre la lecture et l'écriture n'est pas écrasé", async () => {
    H.avantTransaction = () => prisma.planningCreneau.create({ data: { employeeId: ouvert, date: d("2026-10-19"), shiftId: soir } });
    const r = await genererPlanningAuto("2026-10-19", "2026-10-19", fd({ modeles: "on" }));
    expect(r.erreur).toBeUndefined();
    expect(await creneau(ouvert, "2026-10-19")).toMatchObject({ shiftId: soir, genereAuto: false });
    expect(await journal(ouvert, "2026-10-19")).toHaveLength(0);
    expect((await creneau(valide, "2026-10-19"))?.shiftId).toBe(matin);
  });

  it("« écraser » : le créneau posé entre la lecture et l'écriture est effacé comme le reste de la période", async () => {
    H.avantTransaction = () => prisma.planningCreneau.create({ data: { employeeId: ouvert, date: d("2026-10-27"), shiftId: soir } });
    const r = await genererPlanningAuto("2026-10-26", "2026-10-27", fd({ modeles: "on", ecraser: "on" }));
    expect(r.erreur).toBeUndefined();
    expect(await creneau(ouvert, "2026-10-27")).toBeNull();
    expect((await journal(ouvert, "2026-10-27")).map((e) => [e.ancienneValeur, e.nouvelleValeur])).toEqual([[soir, null]]);
  });
});

describe("demandes approuvées par la Direction", () => {
  it("approuverEchange : échange touchant un salarié verrouillé → renvoi vers /a-valider avec le message, échange en attente", async () => {
    const e = await prisma.echangeCreneau.create({ data: {
      demandeurId: ouvert, demandeurDate: d("2026-09-10"), demandeurShiftId: matin,
      collegueId: valide, collegueDate: d("2026-09-12"), collegueShiftId: matin, reponseCollegue: "ACCEPTE",
    } });
    await expect(approuverEchange(e.id)).rejects.toThrow(`REDIRECT /a-valider?erreur=${encodeURIComponent(MESSAGE)}`);
    // Ni appliqué ni « approuvé par la Direction » : l'espace salarié affiche toujours « en attente
    // de la Direction », pas « Direction : approuvé ».
    expect(await prisma.echangeCreneau.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ statut: "EN_ATTENTE", reponseDirection: "EN_ATTENTE" });
    expect(await creneau(valide, "2026-09-10")).toBeNull();
  });

  it("approuverEchange : collègue pas encore d'accord → seule l'approbation de la Direction s'écrit", async () => {
    const e = await prisma.echangeCreneau.create({ data: {
      demandeurId: ouvert, demandeurDate: d("2026-09-10"), demandeurShiftId: matin,
      collegueId: valide, collegueDate: d("2026-09-12"), collegueShiftId: matin,
    } });
    await approuverEchange(e.id);
    expect(await prisma.echangeCreneau.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ statut: "EN_ATTENTE", reponseDirection: "APPROUVE" });
  });

  it("approuverChangementShift : salarié verrouillé → renvoi vers /a-valider, demande en attente, rien d'écrit", async () => {
    const dem = await prisma.demandeChangementShift.create({ data: { employeeId: valide, date: d("2026-09-16"), shiftDemandeId: soir } });
    await expect(approuverChangementShift(dem.id)).rejects.toThrow(`REDIRECT /a-valider?erreur=${encodeURIComponent(MESSAGE)}`);
    expect((await prisma.demandeChangementShift.findUniqueOrThrow({ where: { id: dem.id } })).statut).toBe("EN_ATTENTE");
    expect(await creneau(valide, "2026-09-16")).toBeNull();
  });

  it("approuverChangementShift : mois ouvert → créneau posé, demande approuvée, journal au nom de la Direction", async () => {
    const dem = await prisma.demandeChangementShift.create({ data: { employeeId: ouvert, date: d("2026-09-16"), shiftDemandeId: soir } });
    await approuverChangementShift(dem.id);
    expect((await prisma.demandeChangementShift.findUniqueOrThrow({ where: { id: dem.id } })).statut).toBe("APPROUVE");
    expect(await creneau(ouvert, "2026-09-16")).toMatchObject({ shiftId: soir, genereAuto: false });
    expect((await journal(ouvert, "2026-09-16")).map((e) => [e.ancienneValeur, e.nouvelleValeur, e.userId])).toEqual([[null, soir, A.user.id]]);
  });

  it("approuverEchange : mois ouvert, jours différents → permutation tracée, échange approuvé", async () => {
    const josee = (await prisma.employee.create({ data: {
      sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 200,
      dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0, matricule: "JO01-PEF", nom: "Josée Kabila", actif: false,
    } })).id;
    await prisma.planningCreneau.createMany({ data: [
      { employeeId: ouvert, date: d("2026-10-20"), shiftId: matin },
      { employeeId: josee, date: d("2026-10-21"), shiftId: soir },
    ] });
    const e = await prisma.echangeCreneau.create({ data: {
      demandeurId: ouvert, demandeurDate: d("2026-10-20"), demandeurShiftId: matin,
      collegueId: josee, collegueDate: d("2026-10-21"), collegueShiftId: soir, reponseCollegue: "ACCEPTE",
    } });
    await approuverEchange(e.id);
    expect(await prisma.echangeCreneau.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ statut: "APPROUVE", reponseDirection: "APPROUVE" });
    expect(await creneau(ouvert, "2026-10-20")).toBeNull();
    expect((await creneau(ouvert, "2026-10-21"))?.shiftId).toBe(soir);
    expect((await creneau(josee, "2026-10-20"))?.shiftId).toBe(matin);
    expect(await creneau(josee, "2026-10-21")).toBeNull();
    expect(await prisma.journalAudit.count({ where: { entite: "PlanningCreneau", userId: A.user.id, entiteId: { endsWith: "|2026-10-20" } } })).toBe(2);
    expect(await prisma.journalAudit.count({ where: { entite: "PlanningCreneau", userId: A.user.id, entiteId: { endsWith: "|2026-10-21" } } })).toBe(2);
  });
});
