import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// Valider une ligne de paie revérifie son montant (revue finale du 2026-09-24, point 1) : verrou de
// la ligne, recalcul du mois par le VRAI calcul, comparaison au centime. Un écart refuse TOUTE la
// transaction (une ligne, un lot, la clôture), avec un message lisible, et rien n'est écrit : ni
// statut, ni transition, ni bulletin figé, ni journal. La ligne n'est jamais réécrite en silence.
// Les tests s'enchaînent sur une même base : l'ordre compte.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { calculerPaieDuMois, changerStatutPaie, changerStatutEnLot, cloturerPaie } = await import("./actions");
const { rafraichirPaieDuMois } = await import("@/lib/paie-refresh");
const { messagePaieChangee, messageErreurValidation, MESSAGE_LIGNE_RECALCULEE, MESSAGE_VALIDATION_OCCUPEE } = await import("@/lib/paie-validation");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let url = "";
let journee = "";
const ids = { ada: "", beatrice: "", clarisse: "", dieudonne: "" };

const d = (n: number, mois = 9) => new Date(Date.UTC(2026, mois - 1, n));
const SAISI = new Date("2026-10-01T08:00:00Z");
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirection = (message: string) => `REDIRECT /paie?erreur=${encodeURIComponent(message)}`;
const ligne = (employeeId: string, mois = 9) => prisma.payrollLine.findFirstOrThrow({ where: { employeeId, payrollRun: { mois, annee: 2026 } } });
const joursOuvres = (mois: number) =>
  Array.from({ length: new Date(Date.UTC(2026, mois, 0)).getUTCDate() }, (_, i) => d(i + 1, mois)).filter((x) => x.getUTCDay() >= 1 && x.getUTCDay() <= 5);

/** Rien n'a été écrit pour la ligne : statut, transition, bulletin figé, journal. */
async function rienEcrit(employeeId: string, mois = 9) {
  const l = await ligne(employeeId, mois);
  expect(l.statutPaiement).toBe("PAS_VALIDE");
  expect(await prisma.transitionPaie.count({ where: { payrollLineId: l.id } })).toBe(0);
  expect(await prisma.versionBulletin.count({ where: { payrollLineId: l.id } })).toBe(0);
  expect(await prisma.journalAudit.count({ where: { entite: "PayrollLine", entiteId: l.id } })).toBe(0);
  return l;
}

async function brigade(matricule: string, nom: string) {
  const id = (await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Brigade", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel: 300, heuresHebdomadaires: 45, heuresParJour: 9, enfants: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDD",
  } })).id;
  // Planning lun–ven de septembre, tout fait : net = salaire.
  await prisma.planningCreneau.createMany({ data: joursOuvres(9).map((date) => ({ employeeId: id, date, shiftId: journee })) });
  await prisma.attendance.createMany({ data: joursOuvres(9).map((date) => ({ employeeId: id, date, code: "P", createdAt: SAISI, updatedAt: SAISI })) });
  await prisma.overtimeEntry.createMany({ data: joursOuvres(9).map((date) => ({ employeeId: id, date, heuresTravaillees: 9, createdAt: SAISI, updatedAt: SAISI })) });
  return id;
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; url = db.url; H.client = prisma;
  const exercice = await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: exercice.id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  journee = (await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } })).id; // 9 h

  ids.ada = await brigade("AK01-PEF", "Ada Kalala");
  ids.beatrice = await brigade("BM01-PEF", "Béatrice Mbuyi");
  ids.clarisse = await brigade("CN01-PEF", "Clarisse Nsimba");
  ids.dieudonne = (await prisma.employee.create({ data: {
    matricule: "DT01-PEF", nom: "Dieudonné Tshala", sexe: "M", etatCivil: "Marié", poste: "Comptable", secteur: "Administration",
    categorie: "BACKOFFICE", salaireMensuel: 500, dateEmbauche: new Date("2024-01-01T00:00:00Z"), contrat: "CDI", enfants: 1,
  } })).id;

  await calculerPaieDuMois();
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("valider une ligne revérifie son montant", () => {
  it("ligne recalculée identique : la validation passe (bulletin figé, transition, journal)", async () => {
    const l = await ligne(ids.ada);
    expect(l.sourceReference).toBe("PLANNING");
    expect(Number(l.salNetUSD)).toBeGreaterThan(0);
    await changerStatutPaie(l.id, fd({ versStatut: "VALIDE" }));
    const apres = await ligne(ids.ada);
    expect(apres.statutPaiement).toBe("VALIDE");
    expect(apres.salNetUSD.toString()).toBe(l.salNetUSD.toString());
    expect(await prisma.versionBulletin.count({ where: { payrollLineId: l.id } })).toBe(1);
    expect(await prisma.transitionPaie.count({ where: { payrollLineId: l.id } })).toBe(1);
  });

  it("planning modifié après le calcul (un créneau effacé sans recalcul) : refus lisible, rien d'écrit, ligne intacte", async () => {
    const avant = await ligne(ids.beatrice);
    // Créneau du mercredi 16 effacé après le calcul : 9 h de moins dans la référence (les heures
    // faites ce jour-là restent), donc un autre taux et un autre net.
    await prisma.planningCreneau.delete({ where: { employeeId_date: { employeeId: ids.beatrice, date: d(16) } } });
    await expect(changerStatutPaie(avant.id, fd({ versStatut: "VALIDE" }))).rejects.toThrow(
      redirection("La paie de Béatrice Mbuyi a changé depuis son calcul (planning ou heures modifiés) : rechargez la page Paie avant de valider."),
    );
    const apres = await rienEcrit(ids.beatrice);
    // Jamais réécrite en silence : la ligne garde le montant affiché.
    expect(apres.id).toBe(avant.id);
    expect(apres.salNetUSD.toString()).toBe(avant.salNetUSD.toString());
    expect(apres.heuresContractuelles.toString()).toBe(avant.heuresContractuelles.toString());
  });

  it("lot avec une ligne qui a changé : TOUT le lot est refusé, la ligne intacte n'est pas validée non plus", async () => {
    const clarisse = await ligne(ids.clarisse);
    const beatrice = await ligne(ids.beatrice);
    expect(await changerStatutEnLot([clarisse.id, beatrice.id], "VALIDE")).toEqual({ erreur: messagePaieChangee(["Béatrice Mbuyi"]) });
    await rienEcrit(ids.clarisse);
    await rienEcrit(ids.beatrice);
  });

  it("ligne hors brigade (back-office) : même contrôle — une prime saisie après le calcul refuse la validation", async () => {
    await prisma.prime.create({ data: { employeeId: ids.dieudonne, nom: "Prime de fin de mois", montantUSD: 40, mois: 9, annee: 2026 } });
    const l = await ligne(ids.dieudonne);
    expect(l.sourceReference).toBe("CONTRAT");
    await expect(changerStatutPaie(l.id, fd({ versStatut: "VALIDE" }))).rejects.toThrow(redirection(messagePaieChangee(["Dieudonné Tshala"])));
    await rienEcrit(ids.dieudonne);
  });

  it("clôture : même règle — une seule ligne changée annule la clôture entière", async () => {
    await expect(cloturerPaie()).rejects.toThrow(
      redirection(`Clôture annulée (aucun bulletin validé) : ${messagePaieChangee(["Béatrice Mbuyi", "Dieudonné Tshala"])}`),
    );
    await rienEcrit(ids.clarisse);
    await rienEcrit(ids.beatrice);
    await rienEcrit(ids.dieudonne);
    expect((await prisma.payrollRun.findFirstOrThrow({ where: { mois: 9, annee: 2026 } })).statut).not.toBe("VALIDE");
  });

  it("ligne remplacée par un recalcul depuis l'affichage (écran « À valider » périmé) : refus lisible, jamais ignorée en silence", async () => {
    const perimee = (await ligne(ids.clarisse)).id;
    await rafraichirPaieDuMois({ creerRun: false }); // quelqu'un ouvre /paie : les lignes non figées sont recréées
    expect(await prisma.payrollLine.count({ where: { id: perimee } })).toBe(0);
    expect(await changerStatutEnLot([perimee], "VALIDE")).toEqual({ erreur: MESSAGE_LIGNE_RECALCULEE });
    await expect(changerStatutPaie(perimee, fd({ versStatut: "VALIDE" }))).rejects.toThrow(redirection(MESSAGE_LIGNE_RECALCULEE));
  });

  it("concurrence : une écriture du planning en cours fait attendre la validation, qui voit ensuite le créneau effacé et refuse", async () => {
    const l = await ligne(ids.clarisse);
    const externe = new Client({ connectionString: url });
    await externe.connect();
    let validation: Promise<unknown> | undefined;
    try {
      // Ce que fait `ecrireCreneaux` : ligne de paie en FOR SHARE, puis créneau écrit, transaction ouverte.
      await externe.query("BEGIN");
      await externe.query(`SELECT "id" FROM "public"."PayrollLine" WHERE "id" = $1 FOR SHARE`, [l.id]);
      await externe.query(`DELETE FROM "public"."PlanningCreneau" WHERE "employeeId" = $1 AND "date" = $2`, [ids.clarisse, d(18)]);
      let fini = false;
      validation = changerStatutPaie(l.id, fd({ versStatut: "VALIDE" })).then(() => null, (e: unknown) => e).finally(() => { fini = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(fini).toBe(false); // elle attend le verrou de la ligne
      await externe.query("COMMIT");
      const erreur = await validation;
      expect((erreur as Error).message).toBe(redirection(messagePaieChangee(["Clarisse Nsimba"])));
    } finally {
      await externe.query("ROLLBACK").catch(() => {});
      await validation;
      await externe.end();
    }
    await rienEcrit(ids.clarisse);
  });

  it("après rechargement de la page Paie, le lot se valide", async () => {
    await rafraichirPaieDuMois({ creerRun: false });
    const lignes = await Promise.all([ids.beatrice, ids.clarisse, ids.dieudonne].map((e) => ligne(e)));
    expect(await changerStatutEnLot(lignes.map((l) => l.id), "VALIDE")).toBe(3);
    for (const l of lignes) expect((await prisma.payrollLine.findUniqueOrThrow({ where: { id: l.id } })).statutPaiement).toBe("VALIDE");
  });

  it("mois antérieur à la date d'effet (référence contrat) : même contrôle", async () => {
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 8 } });
    await calculerPaieDuMois();
    const l = await ligne(ids.ada, 8);
    expect(l.sourceReference).toBe("CONTRAT");
    // Heures saisies après le calcul d'août : 9 h travaillées le lundi 3.
    await prisma.attendance.create({ data: { employeeId: ids.ada, date: d(3, 8), code: "P" } });
    await prisma.overtimeEntry.create({ data: { employeeId: ids.ada, date: d(3, 8), heuresTravaillees: 9 } });
    await expect(changerStatutPaie(l.id, fd({ versStatut: "VALIDE" }))).rejects.toThrow(redirection(messagePaieChangee(["Ada Kalala"])));
    await rienEcrit(ids.ada, 8);
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 9 } });
  });

  it("attente de verrou trop longue (vraie erreur Postgres 55P03 via Prisma) : message lisible, jamais une page d'erreur", async () => {
    const l = await ligne(ids.ada);
    const externe = new Client({ connectionString: url });
    await externe.connect();
    try {
      await externe.query("BEGIN");
      await externe.query(`SELECT "id" FROM "public"."PayrollLine" WHERE "id" = $1 FOR UPDATE`, [l.id]);
      const erreur = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '200ms'");
        await tx.$queryRaw`SELECT "id" FROM "public"."PayrollLine" WHERE "id" = ${l.id} FOR UPDATE`;
      }).then(() => null, (e: unknown) => e);
      expect(erreur).not.toBeNull();
      expect(messageErreurValidation(erreur)).toBe(MESSAGE_VALIDATION_OCCUPEE);
      expect(messageErreurValidation(new Error("autre chose"))).toBeNull();
    } finally {
      await externe.query("ROLLBACK");
      await externe.end();
    }
  });
});

describe("recalcul de la paie (paie-refresh) : verrou de la run du mois", () => {
  it("une écriture du planning en cours fait attendre le recalcul, qui écrit ensuite le planning à jour", async () => {
    await prisma.config.update({ where: { id: "singleton" }, data: { moisCourant: 9 } });
    const elodie = await brigade("EM01-PEF", "Élodie Mwamba");
    await rafraichirPaieDuMois({ creerRun: false });
    const avant = await ligne(elodie);
    expect(avant.statutPaiement).toBe("PAS_VALIDE");

    const externe = new Client({ connectionString: url });
    await externe.connect();
    let recalcul: Promise<unknown> | undefined;
    try {
      // Ce que fait désormais `ecrireCreneaux` : run du mois FOR SHARE, puis créneau écrit, transaction ouverte.
      await externe.query("BEGIN");
      await externe.query(`SELECT "id" FROM "public"."PayrollRun" WHERE "mois" = 9 AND "annee" = 2026 FOR SHARE`);
      await externe.query(`DELETE FROM "public"."PlanningCreneau" WHERE "employeeId" = $1 AND "date" = $2`, [elodie, d(22)]);
      let fini = false;
      recalcul = rafraichirPaieDuMois({ creerRun: false }).finally(() => { fini = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(fini).toBe(false); // il attend la fin de l'écriture du planning
      await externe.query("COMMIT");
      await recalcul;
    } finally {
      await externe.query("ROLLBACK").catch(() => {});
      await recalcul?.catch(() => {});
      await externe.end();
    }
    // Le recalcul a lu le planning APRÈS l'écriture : 9 h de moins dans la référence.
    const apres = await ligne(elodie);
    expect(Number(apres.heuresContractuelles)).toBe(Number(avant.heuresContractuelles) - 9);
    // Et la ligne enregistrée est exactement celle que la validation recalcule : elle passe.
    await changerStatutPaie(apres.id, fd({ versStatut: "VALIDE" }));
    expect((await ligne(elodie)).statutPaiement).toBe("VALIDE");
  });
});

describe("« À valider » recalcule à l'ouverture, comme /paie (même fonction)", () => {
  it("planning changé depuis le dernier /paie : ouvrir « À valider » recalcule la ligne, qui se valide ensuite", async () => {
    const { default: AValiderPage } = await import("../a-valider/page");
    const fanny = await brigade("FK01-PEF", "Fanny Kabongo");
    await rafraichirPaieDuMois({ creerRun: false });
    const avant = await ligne(fanny);
    // Créneau effacé après le dernier /paie : sans recalcul, la ligne affichée serait refusée.
    await prisma.planningCreneau.delete({ where: { employeeId_date: { employeeId: fanny, date: d(23) } } });

    await AValiderPage({ searchParams: Promise.resolve({}) });

    const apres = await ligne(fanny);
    expect(apres.id).not.toBe(avant.id);
    expect(Number(apres.heuresContractuelles)).toBe(Number(avant.heuresContractuelles) - 9);
    expect(await changerStatutEnLot([apres.id], "VALIDE")).toBe(1);
  });

  it("aucune ligne ouverte : rien n'est recalculé, comme /paie (aucune ligne créée, lignes figées intactes)", async () => {
    const { default: AValiderPage } = await import("../a-valider/page");
    const figees = await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, orderBy: { id: "asc" } });
    expect(figees.every((l) => l.statutPaiement !== "PAS_VALIDE")).toBe(true);
    const gaston = await brigade("GM01-PEF", "Gaston Mbala"); // actif, pas encore de ligne
    await AValiderPage({ searchParams: Promise.resolve({}) });
    expect(await prisma.payrollLine.findMany({ where: { payrollRun: { mois: 9, annee: 2026 } }, orderBy: { id: "asc" } })).toEqual(figees);
    expect(await prisma.payrollLine.count({ where: { employeeId: gaston } })).toBe(0);
  });

  it("/paie et « À valider » appellent la même fonction, et « À valider » avant de lire les lignes", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const paie = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const aValider = readFileSync(join(__dirname, "../a-valider/page.tsx"), "utf8");
    expect(paie).toContain("await rafraichirPaieAffichee(mois, annee);");
    expect(paie).not.toContain("rafraichirPaieDuMois");
    const appel = aValider.indexOf("await rafraichirPaieAffichee(config.moisCourant, config.anneeCourante)");
    expect(appel).toBeGreaterThan(0);
    expect(appel).toBeLessThan(aValider.indexOf("prisma.payrollLine.findMany"));
    expect(aValider).not.toContain("rafraichirPaieDuMois");
  });
});
