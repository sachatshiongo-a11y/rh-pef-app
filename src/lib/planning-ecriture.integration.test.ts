import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { creerBaseTest } from "@/lib/test/db";

// Le planning est une pièce de paie depuis le 2026-09-23 : tracé à chaque changement, verrouillé
// pour un salarié dont la paie du mois est VALIDÉE ou PAYÉE (décision Direction 3).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { ecrireCreneaux, PlanningVerrouilleError, estInterblocage, messageErreurPlanning, MESSAGE_INTERBLOCAGE } = await import("./planning-ecriture");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let url = "";
let userId = "";
let valide = "";
let ouvert = "";
let matin = "";
let soir = "";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ecrire = (ops: { employeeId: string; date: Date; shiftId: string | null }[], opts?: { genereAuto?: boolean }) =>
  prisma.$transaction((tx) => ecrireCreneaux(tx, userId, ops, opts));
const journal = (employeeId: string, iso: string) =>
  prisma.journalAudit.findMany({ where: { entite: "PlanningCreneau", entiteId: `${employeeId}|${iso}` }, orderBy: { date: "asc" } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; url = db.url; H.client = prisma;
  userId = (await prisma.user.create({ data: { email: "planning@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE" as const, salaireMensuel: 200, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0 };
  valide = (await prisma.employee.create({ data: { ...base, matricule: "VA01-PEF", nom: "Martine Mutombo" } })).id;
  ouvert = (await prisma.employee.create({ data: { ...base, matricule: "OU01-PEF", nom: "Rachel Lunda" } })).id;
  matin = (await prisma.shift.create({ data: { nom: "Matin", heureDebut: "08:00", heureFin: "16:00" } })).id;
  soir = (await prisma.shift.create({ data: { nom: "Soir", heureDebut: "16:00", heureFin: "22:00" } })).id;
  const run = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2300 } });
  const montants = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: valide, statutPaiement: "VALIDE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: ouvert, statutPaiement: "PAS_VALIDE" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("ecrireCreneaux — trace", () => {
  it("création, modification, suppression : une entrée de journal chacune, avant → après", async () => {
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-10"), shiftId: matin }])).toBe(1);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-10"), shiftId: soir }])).toBe(1);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-10"), shiftId: null }])).toBe(1);
    const j = await journal(ouvert, "2026-09-10");
    expect(j.map((e) => [e.ancienneValeur, e.nouvelleValeur, e.userId, e.champ])).toEqual([
      [null, matin, userId, "shiftId"],
      [matin, soir, userId, "shiftId"],
      [soir, null, userId, "shiftId"],
    ]);
    expect(await prisma.planningCreneau.count({ where: { employeeId: ouvert, date: d("2026-09-10") } })).toBe(0);
  });

  it("réécrire le même shift ne change rien et ne journalise rien", async () => {
    await ecrire([{ employeeId: ouvert, date: d("2026-09-11"), shiftId: matin }]);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-11"), shiftId: matin }])).toBe(0);
    expect(await journal(ouvert, "2026-09-11")).toHaveLength(1);
  });

  it("génération automatique : le marqueur genereAuto est posé", async () => {
    await ecrire([{ employeeId: ouvert, date: d("2026-09-12"), shiftId: matin }], { genereAuto: true });
    expect((await prisma.planningCreneau.findFirstOrThrow({ where: { employeeId: ouvert, date: d("2026-09-12") } })).genereAuto).toBe(true);
  });

  it("supprimer un créneau absent : 0 changement, 0 entrée de journal", async () => {
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-22"), shiftId: null }])).toBe(0);
    expect(await journal(ouvert, "2026-09-22")).toHaveLength(0);
  });
});

describe("ecrireCreneaux — verrou", () => {
  it("paie VALIDÉE du salarié pour ce mois → refus, message lisible, RIEN d'écrit (lot compris)", async () => {
    const tentative = ecrire([
      { employeeId: ouvert, date: d("2026-09-15"), shiftId: matin },
      { employeeId: valide, date: d("2026-09-15"), shiftId: matin },
    ]);
    await expect(tentative).rejects.toBeInstanceOf(PlanningVerrouilleError);
    await expect(ecrire([{ employeeId: valide, date: d("2026-09-15"), shiftId: matin }])).rejects.toThrow(
      "Planning verrouillé : paie validée ou payée pour Martine Mutombo (septembre 2026). Rouvrir la ligne de paie avant de modifier ce planning.",
    );
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-15") } })).toBe(0);
    expect(await journal(ouvert, "2026-09-15")).toHaveLength(0);
  });

  it("même salarié, autre mois → autorisé ; autre salarié, même mois → autorisé", async () => {
    expect(await ecrire([{ employeeId: valide, date: d("2026-10-01"), shiftId: matin }])).toBe(1);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-16"), shiftId: matin }])).toBe(1);
  });

  it("lot croisé : salarié validé en septembre mais écrit en octobre, l'autre en septembre → autorisé", async () => {
    expect(await ecrire([
      { employeeId: valide, date: d("2026-10-02"), shiftId: matin },
      { employeeId: ouvert, date: d("2026-09-17"), shiftId: matin },
    ])).toBe(2);
  });

  it("paie PAYÉE → refus aussi", async () => {
    await prisma.payrollLine.updateMany({ where: { employeeId: valide }, data: { statutPaiement: "PAYE" } });
    await expect(ecrire([{ employeeId: valide, date: d("2026-09-20"), shiftId: null }])).rejects.toThrow(
      "Planning verrouillé : paie validée ou payée pour Martine Mutombo (septembre 2026). Rouvrir la ligne de paie avant de modifier ce planning.",
    );
  });

  it("tout ou rien SANS transaction : client global, lot [ouvert, verrouillé] → rien d'écrit, ni créneau ni journal", async () => {
    // Pas de $transaction ici : si le verrou était vérifié APRÈS les écritures, le créneau du
    // salarié ouvert resterait en base (rien ne l'annulerait).
    await expect(ecrireCreneaux(prisma, userId, [
      { employeeId: ouvert, date: d("2026-09-21"), shiftId: matin },
      { employeeId: valide, date: d("2026-09-21"), shiftId: matin },
    ])).rejects.toBeInstanceOf(PlanningVerrouilleError);
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-21") } })).toBe(0);
    expect(await journal(ouvert, "2026-09-21")).toHaveLength(0);
    expect(await journal(valide, "2026-09-21")).toHaveLength(0);
  });

  it("concurrence : pendant l'écriture, la validation de la paie du salarié attend (verrou partagé sur la ligne)", async () => {
    const externe = new Client({ connectionString: url });
    await externe.connect();
    let relacher!: () => void;
    const relache = new Promise<void>((r) => { relacher = r; });
    let ecrit!: () => void;
    const aEcrit = new Promise<void>((r) => { ecrit = r; });
    const ecriture = prisma.$transaction(async (tx) => {
      await ecrireCreneaux(tx, userId, [{ employeeId: ouvert, date: d("2026-09-23"), shiftId: matin }]);
      ecrit();
      await relache; // transaction encore ouverte : le verrou partagé est tenu
    });
    try {
      // Course avec `ecriture` : si la transaction échoue avant d'avoir écrit, le test échoue au lieu de rester bloqué.
      await Promise.race([aEcrit, ecriture]);
      await externe.query("SET lock_timeout = '300ms'");
      // La « validation » concurrente : même UPDATE que la validation d'une ligne de paie.
      await expect(
        externe.query(`UPDATE "public"."PayrollLine" SET "statutPaiement" = 'VALIDE' WHERE "employeeId" = $1`, [ouvert]),
      ).rejects.toMatchObject({ code: "55P03" }); // lock_not_available : elle a dû attendre
    } finally {
      relacher();
      await ecriture;
      await externe.end();
    }
    expect((await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ouvert } })).statutPaiement).toBe("PAS_VALIDE");
  });

  it("concurrence : pendant l'écriture, le recalcul de la paie attend (verrou partagé sur la run du mois, qui ne disparaît pas)", async () => {
    // Le recalcul (paie-refresh.ts) supprime puis recrée les lignes non figées : un verrou sur elles
    // ne le retient pas. La run du mois, elle, reste : l'écriture la lit FOR SHARE, le recalcul la
    // prend FOR UPDATE.
    const externe = new Client({ connectionString: url });
    await externe.connect();
    let relacher!: () => void;
    const relache = new Promise<void>((r) => { relacher = r; });
    let ecrit!: () => void;
    const aEcrit = new Promise<void>((r) => { ecrit = r; });
    const ecriture = prisma.$transaction(async (tx) => {
      await ecrireCreneaux(tx, userId, [{ employeeId: ouvert, date: d("2026-09-25"), shiftId: soir }]);
      ecrit();
      await relache;
    });
    try {
      await Promise.race([aEcrit, ecriture]);
      await externe.query("SET lock_timeout = '300ms'");
      await expect(
        externe.query(`SELECT "id" FROM "public"."PayrollRun" WHERE "mois" = 9 AND "annee" = 2026 FOR UPDATE`),
      ).rejects.toMatchObject({ code: "55P03" });
      // Une run d'un mois NON touché par l'écriture reste libre.
      await prisma.payrollRun.create({ data: { mois: 11, annee: 2026, tauxChangeUtilise: 2300 } });
      await expect(externe.query(`SELECT "id" FROM "public"."PayrollRun" WHERE "mois" = 11 AND "annee" = 2026 FOR UPDATE`)).resolves.toBeDefined();
    } finally {
      relacher();
      await ecriture;
      await externe.end();
    }
  });

  it("interblocage RÉEL avec une validation de paie → reconnu (40P01) et traduit en message lisible", async () => {
    // Deux lignes de paie ouvertes : l'écriture du planning les prend (FOR SHARE) dans un ordre,
    // la « validation » concurrente les met à jour dans l'autre. Postgres annule l'écriture du
    // planning (son délai de détection est le plus court) : c'est CETTE erreur, telle que Prisma
    // la rend, que les actions doivent reconnaître.
    const base = { sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE" as const, salaireMensuel: 200, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0 };
    const autre = (await prisma.employee.create({ data: { ...base, matricule: "IB01-PEF", nom: "Ida Bolamba" } })).id;
    const run = await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 } });
    const montants = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
    await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: autre, statutPaiement: "PAS_VALIDE" } });

    const externe = new Client({ connectionString: url });
    await externe.connect();
    let continuer!: () => void;
    const suite = new Promise<void>((r) => { continuer = r; });
    let premier!: () => void;
    const aPremier = new Promise<void>((r) => { premier = r; });
    const ecriture = prisma.$transaction(async (tx) => {
      await ecrireCreneaux(tx, userId, [{ employeeId: ouvert, date: d("2026-09-24"), shiftId: matin }]); // FOR SHARE ligne « ouvert »
      premier();
      await suite;
      await ecrireCreneaux(tx, userId, [{ employeeId: autre, date: d("2026-09-24"), shiftId: matin }]); // attend la ligne « autre »
    }, { timeout: 20_000 });
    const resultat = ecriture.then(() => null, (e: unknown) => e);
    try {
      await Promise.race([aPremier, ecriture]);
      await externe.query("BEGIN");
      await externe.query("SET LOCAL deadlock_timeout = '10s'"); // la validation n'est jamais la victime
      await externe.query(`UPDATE "public"."PayrollLine" SET "statutPaiement" = 'VALIDE' WHERE "employeeId" = $1`, [autre]);
      continuer();
      await new Promise((r) => setTimeout(r, 200)); // l'écriture attend maintenant la ligne « autre »
      const croisee = externe.query(`UPDATE "public"."PayrollLine" SET "statutPaiement" = 'VALIDE' WHERE "employeeId" = $1`, [ouvert]);
      const erreur = await resultat;
      await croisee;
      await externe.query("ROLLBACK");
      expect(estInterblocage(erreur)).toBe(true);
      expect(messageErreurPlanning(erreur)).toBe(MESSAGE_INTERBLOCAGE);
    } finally {
      continuer();
      await resultat;
      await externe.end();
    }
    // L'écriture du planning a été annulée en bloc.
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-24") } })).toBe(0);
  });
});

describe("ecrireCreneaux — erreurs de programmation, levées avant toute lecture ou écriture", () => {
  // Un client qui note chaque accès et refuse tout : l'erreur attendue doit sortir SANS l'avoir touché.
  const espion = () => {
    const acces: string[] = [];
    const tx = new Proxy({}, { get: (_t, p) => { acces.push(String(p)); throw new Error(`client touché : ${String(p)}`); } });
    return { acces, tx: tx as Prisma.TransactionClient };
  };

  it("opération en double (même salarié, même jour) → erreur, rien d'écrit", async () => {
    await expect(ecrire([
      { employeeId: ouvert, date: d("2026-09-18"), shiftId: matin },
      { employeeId: ouvert, date: d("2026-09-18"), shiftId: soir },
    ])).rejects.toThrow(`ecrireCreneaux : opération en double pour ${ouvert}|2026-09-18`);
    expect(await prisma.planningCreneau.count({ where: { employeeId: ouvert, date: d("2026-09-18") } })).toBe(0);
    expect(await journal(ouvert, "2026-09-18")).toHaveLength(0);
    const { acces, tx } = espion();
    await expect(ecrireCreneaux(tx, userId, [
      { employeeId: ouvert, date: d("2026-09-18"), shiftId: matin },
      { employeeId: ouvert, date: d("2026-09-18"), shiftId: null },
    ])).rejects.toThrow(`ecrireCreneaux : opération en double pour ${ouvert}|2026-09-18`);
    expect(acces).toEqual([]);
  });

  it("date qui n'est pas à minuit UTC (heure de Kinshasa, date invalide) → erreur, rien d'écrit", async () => {
    const kinshasa = new Date("2026-09-19T00:00:00+01:00"); // = 18/09 23:00 UTC
    await expect(ecrire([
      { employeeId: ouvert, date: d("2026-09-19"), shiftId: matin },
      { employeeId: ouvert, date: kinshasa, shiftId: matin },
    ])).rejects.toThrow(`ecrireCreneaux : date non normalisée pour ${ouvert} (2026-09-18T23:00:00.000Z) : attendu minuit UTC`);
    expect(await prisma.planningCreneau.count({ where: { employeeId: ouvert, date: { in: [d("2026-09-18"), d("2026-09-19")] } } })).toBe(0);
    const { acces, tx } = espion();
    await expect(ecrireCreneaux(tx, userId, [{ employeeId: ouvert, date: kinshasa, shiftId: matin }])).rejects.toThrow("date non normalisée");
    await expect(ecrireCreneaux(tx, userId, [{ employeeId: ouvert, date: new Date("n'importe quoi"), shiftId: matin }])).rejects.toThrow(
      `ecrireCreneaux : date non normalisée pour ${ouvert} (date invalide) : attendu minuit UTC`,
    );
    expect(acces).toEqual([]);
  });
});
