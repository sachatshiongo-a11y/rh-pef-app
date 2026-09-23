import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import type { PositionScan } from "@/lib/pointage-qr";

// Le scan de l'affiche QR, contre une VRAIE base (Postgres embarqué). Chaque refus est suivi d'une
// RELECTURE de la base : un refus qui aurait écrit une moitié de pointage serait pire qu'une erreur.
// Les actions serveur (`app/pointage/actions.ts`) sont testées en fin de fichier avec la session
// mockée, comme `espace/signature-actions.integration.test.ts`.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "EMPLOYE", nom: "Testeur", employeeId: null as string | null } }));
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
  requireRole: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { enregistrerScan, confirmerDepartScan } = await import("./pointage-scan");
const { scannerAffiche, confirmerDepart } = await import("@/app/pointage/actions");

const MESSAGE_AFFICHE = "Cette affiche n'est plus valable, demandez la nouvelle à la Direction.";
const CODE = "code-affiche-en-vigueur";
const RESTAURANT = { lat: -4.3217, lng: 15.3125 };
const AU_RESTAURANT: PositionScan = { lat: -4.3218, lng: 15.3126, precisionM: 20 };
const A_2_KM: PositionScan = { lat: -4.3217 + 0.018, lng: 15.3125, precisionM: 20 }; // ≈ 2 km au nord
const REFUSEE: PositionScan = { erreur: "REFUSEE" };

// Mardi 15/09/2026, 8 h 02 à Kinshasa (UTC+1).
const ARRIVEE = new Date("2026-09-15T07:02:00Z");
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const JOUR = new Date("2026-09-15T00:00:00Z");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seq = 0;

async function nouvelEmploye(): Promise<{ employeeId: string; userId: string }> {
  seq += 1;
  const emp = await prisma.employee.create({
    data: {
      matricule: `QR${String(seq).padStart(2, "0")}-PEF`, nom: `Salarié ${seq}`, sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  const u = await prisma.user.create({
    data: { email: `salarie.${seq}.qr@test.pef`, nom: emp.nom, role: "EMPLOYE", employeeId: emp.id },
  });
  return { employeeId: emp.id, userId: u.id };
}

/** Ce que la base contient pour un salarié — relu après chaque refus. */
async function base(employeeId: string) {
  const [pointages, scans] = await Promise.all([
    prisma.pointage.findMany({ where: { employeeId } }),
    prisma.scanPointage.findMany({ where: { employeeId }, orderBy: { instant: "asc" } }),
  ]);
  return {
    pointages,
    scans,
    nbPointages: pointages.length,
    nbScans: scans.length,
    nbDeparts: scans.filter((s) => s.moment === "DEPART").length,
  };
}

async function reglerCode(code: string | null) {
  await prisma.config.update({ where: { id: "singleton" }, data: { pointageCode: code } });
}

/**
 * Ralentit (300 ms) les insertions d'un salarié dans `table` : deux scans lancés ensemble se
 * chevauchent alors À COUP SÛR (le second lit la base pendant que le premier écrit encore). Sans
 * ce ralentissement, les deux appels s'exécutent en pratique l'un après l'autre et un test de
 * concurrence resterait vert même sans verrou — un garde-fou qui ne mord pas.
 */
async function ralentirInsertions<T>(table: "Pointage" | "ScanPointage", employeeId: string, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ralentir_test() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ralentir_test BEFORE INSERT ON "public"."${table}" FOR EACH ROW WHEN (NEW."employeeId" = '${employeeId}') EXECUTE FUNCTION ralentir_test()`,
  );
  try {
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ralentir_test ON "public"."${table}"`);
  }
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({
    data: {
      id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9,
      pointageLatitude: RESTAURANT.lat, pointageLongitude: RESTAURANT.lng, pointageRayonM: 150, pointageCode: CODE,
    },
  });
}, 120_000);

afterAll(async () => { await fermer?.(); });
afterEach(async () => {
  vi.useRealTimers();
  await reglerCode(CODE);
});

describe("enregistrerScan — l'arrivée", () => {
  it("arrivée au restaurant → 1 pointage QR + 1 scan AU_RESTAURANT", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });

    expect(r.etat).toBe("ARRIVEE");
    if (r.etat !== "ARRIVEE") return;
    expect(r.heure).toBe(ARRIVEE.toISOString());
    expect(r.verdict.verdict).toBe("AU_RESTAURANT");

    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.pointages[0]).toMatchObject({ source: "QR", heureDebut: ARRIVEE, heureFin: null, creeParId: userId, date: JOUR });
    expect(b.nbScans).toBe(1);
    expect(b.scans[0]).toMatchObject({
      moment: "ARRIVEE", instant: ARRIVEE, verdict: "AU_RESTAURANT", motif: null, pointageId: b.pointages[0].id, precisionM: 20,
    });
    expect(Number(b.scans[0].latitude)).toBeCloseTo(-4.3218, 6);
    expect(b.scans[0].distanceM).toBeLessThan(150);
  });

  it("arrivée à 2 km → pointage créé ET scan A_VERIFIER motif LOIN (jamais refusé pour sa position)", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: A_2_KM, maintenant: ARRIVEE });

    expect(r).toMatchObject({ etat: "ARRIVEE", verdict: { verdict: "A_VERIFIER", motif: "LOIN" } });
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.scans).toHaveLength(1);
    expect(b.scans[0]).toMatchObject({ moment: "ARRIVEE", verdict: "A_VERIFIER", motif: "LOIN", verifieLe: null });
    expect(b.scans[0].distanceM).toBeGreaterThan(1900);
    expect(b.scans[0].distanceM).toBeLessThan(2100);
  });

  it("position refusée → enregistré quand même, motif POSITION_REFUSEE, sans coordonnées", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: REFUSEE, maintenant: ARRIVEE });

    expect(r).toMatchObject({ etat: "ARRIVEE", verdict: { verdict: "A_VERIFIER", motif: "POSITION_REFUSEE" } });
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.scans[0]).toMatchObject({
      verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", latitude: null, longitude: null, precisionM: null, distanceM: null,
    });
  });

  it("l'arrivée est une transaction : si le scan ne peut pas s'écrire, aucun pointage ne reste", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    // Un déclencheur refuse l'écriture du scan de CE salarié : le pointage créé juste avant doit
    // être défait avec lui. Sans transaction, il resterait un pointage sans aucun scan.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION refuser_scan_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'scan refusé (test)'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER refuser_scan_test BEFORE INSERT ON "public"."ScanPointage" FOR EACH ROW WHEN (NEW."employeeId" = '${employeeId}') EXECUTE FUNCTION refuser_scan_test()`,
    );
    try {
      await expect(
        enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE }),
      ).rejects.toThrow();
      const b = await base(employeeId);
      expect(b.nbPointages).toBe(0);
      expect(b.nbScans).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER refuser_scan_test ON "public"."ScanPointage"`);
    }
  });

  it("deux scans d'arrivée simultanés → un seul pointage, un seul scan d'arrivée", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const scan = () => enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const resultats = await ralentirInsertions("Pointage", employeeId, () => Promise.all([scan(), scan()]));

    expect(resultats.map((r) => r.etat).sort()).toEqual(["ARRIVEE", "DEPART_TROP_TOT"]);
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.nbScans).toBe(1);
  });
});

describe("enregistrerScan — le code de l'affiche, vérifié avant toute écriture", () => {
  it("code faux → Error exacte, 0 pointage, 0 scan", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await expect(
      enregistrerScan(prisma, { employeeId, userId, code: "code-faux", position: AU_RESTAURANT, maintenant: ARRIVEE }),
    ).rejects.toThrow(new Error(MESSAGE_AFFICHE));
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(0);
    expect(b.nbScans).toBe(0);
  });

  it("code périmé (config changée entre deux scans) → Error exacte, rien de plus n'est écrit", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    await reglerCode("nouveau-code-apres-changement");

    await expect(
      enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) }),
    ).rejects.toThrow(new Error(MESSAGE_AFFICHE));
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.nbScans).toBe(1); // l'arrivée seule
    expect(b.nbDeparts).toBe(0);
  });

  it("aucun code en config → Error exacte, 0 pointage, 0 scan", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await reglerCode(null);
    await expect(
      enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE }),
    ).rejects.toThrow(new Error(MESSAGE_AFFICHE));
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(0);
    expect(b.nbScans).toBe(0);
  });
});

describe("enregistrerScan — le départ", () => {
  it("second scan à +3 min → DEPART_TROP_TOT, 0 scan DEPART", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 3) });

    expect(r).toEqual({ etat: "DEPART_TROP_TOT", arriveeA: ARRIVEE.toISOString() });
    const b = await base(employeeId);
    expect(b.nbDeparts).toBe(0);
    expect(b.pointages[0].heureFin).toBeNull();
  });

  it("second scan à +3 min avec confirmerDepartRapide → DEPART_A_CONFIRMER", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const r = await enregistrerScan(prisma, {
      employeeId, userId, code: CODE, position: AU_RESTAURANT, confirmerDepartRapide: true, maintenant: plus(ARRIVEE, 3),
    });

    expect(r.etat).toBe("DEPART_A_CONFIRMER");
    const b = await base(employeeId);
    expect(b.nbDeparts).toBe(1);
    expect(b.scans[1].instant).toEqual(plus(ARRIVEE, 3));
  });

  it("second scan à +8 h → DEPART_A_CONFIRMER, 1 scan DEPART, pointage toujours ouvert", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const depart = plus(ARRIVEE, 8 * 60);
    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: A_2_KM, maintenant: depart });

    expect(r.etat).toBe("DEPART_A_CONFIRMER");
    if (r.etat !== "DEPART_A_CONFIRMER") return;
    expect(r.heure).toBe(depart.toISOString());
    expect(r.arriveeA).toBe(ARRIVEE.toISOString());
    expect(r.verdict).toMatchObject({ verdict: "A_VERIFIER", motif: "LOIN" });
    const b = await base(employeeId);
    expect(b.nbDeparts).toBe(1);
    expect(b.scans[1]).toMatchObject({ id: r.scanId, moment: "DEPART", instant: depart, verdict: "A_VERIFIER", motif: "LOIN" });
    expect(b.pointages[0].heureFin).toBeNull(); // le départ n'est clos qu'à la saisie de la pause
  });

  it("troisième scan avant confirmation → même scanId, toujours 1 seul scan DEPART", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const premier = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    const second = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: A_2_KM, maintenant: plus(ARRIVEE, 8 * 60 + 2) });

    expect(premier.etat).toBe("DEPART_A_CONFIRMER");
    expect(second.etat).toBe("DEPART_A_CONFIRMER");
    if (premier.etat !== "DEPART_A_CONFIRMER" || second.etat !== "DEPART_A_CONFIRMER") return;
    expect(second.scanId).toBe(premier.scanId);
    expect(second.heure).toBe(premier.heure); // l'heure du PREMIER scan de départ, pas celle du rescan
    expect(second.verdict).toEqual(premier.verdict);
    const b = await base(employeeId);
    expect(b.nbDeparts).toBe(1);
  });

  it("deux scans de départ simultanés → un seul scan DEPART, le même scanId pour les deux", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const scan = () => enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    const [r1, r2] = await ralentirInsertions("ScanPointage", employeeId, () => Promise.all([scan(), scan()]));

    expect(r1.etat).toBe("DEPART_A_CONFIRMER");
    expect(r2.etat).toBe("DEPART_A_CONFIRMER");
    if (r1.etat !== "DEPART_A_CONFIRMER" || r2.etat !== "DEPART_A_CONFIRMER") return;
    expect(r1.scanId).toBe(r2.scanId);
    expect((await base(employeeId)).nbDeparts).toBe(1);
  });
});

describe("confirmerDepartScan — la pause, puis la clôture", () => {
  it("confirmé 25 min après le scan → heureFin = instant du SCAN, pas de la confirmation", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const instantScan = plus(ARRIVEE, 8 * 60); // 16 h 02
    const d = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: instantScan });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);

    // L'horloge du serveur avance de 25 min pendant que le salarié tape sa pause.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(plus(instantScan, 25));
    const r = await confirmerDepartScan(prisma, { employeeId, scanId: d.scanId, pauseMinutes: 30 });
    vi.useRealTimers();

    expect(r.heureFin).toBe(instantScan.toISOString());
    const b = await base(employeeId);
    expect(b.pointages[0].heureFin).toEqual(instantScan);
    expect(b.pointages[0].pauseMinutes).toBe(30);
  });

  it("heures nettes appliquées aux présences (8 h − 30 min de pause = 7,5 h, code P)", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);

    const r = await confirmerDepartScan(prisma, { employeeId, scanId: d.scanId, pauseMinutes: 30 });
    expect(r.heures).toBe(7.5);

    const heures = await prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId, date: JOUR } } });
    expect(Number(heures?.heuresTravaillees)).toBe(7.5);
    const presence = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: JOUR } } });
    expect(presence?.code).toBe("P");
  });

  it("pause bornée à 600 min et jamais négative", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 12 * 60) });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);

    const r = await confirmerDepartScan(prisma, { employeeId, scanId: d.scanId, pauseMinutes: 5000 });
    expect(r.heures).toBe(2); // 12 h − 10 h
    expect((await base(employeeId)).pointages[0].pauseMinutes).toBe(600);
  });

  it("une seconde confirmation est refusée et ne réécrit rien", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);
    await confirmerDepartScan(prisma, { employeeId, scanId: d.scanId, pauseMinutes: 30 });

    await expect(confirmerDepartScan(prisma, { employeeId, scanId: d.scanId, pauseMinutes: 0 })).rejects.toThrow(/déjà/);
    expect((await base(employeeId)).pointages[0].pauseMinutes).toBe(30);
  });

  it("scan après journée complète → COMPLETE, rien d'écrit", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);
    await confirmerDepartScan(prisma, { employeeId, scanId: d.scanId, pauseMinutes: 30 });
    const avant = await base(employeeId);

    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 9 * 60) });
    expect(r).toEqual({ etat: "COMPLETE" });
    const apres = await base(employeeId);
    expect(apres.nbScans).toBe(avant.nbScans);
    expect(apres.pointages).toEqual(avant.pointages);
  });

  it("confirmer le scan d'un collègue → refus, le pointage du collègue reste ouvert", async () => {
    const collegue = await nouvelEmploye();
    const moi = await nouvelEmploye();
    await enregistrerScan(prisma, { ...collegue, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { ...collegue, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);

    await expect(
      confirmerDepartScan(prisma, { employeeId: moi.employeeId, scanId: d.scanId, pauseMinutes: 30 }),
    ).rejects.toThrow("Ce départ est introuvable.");
    const b = await base(collegue.employeeId);
    expect(b.pointages[0].heureFin).toBeNull();
    expect(await prisma.overtimeEntry.count({ where: { employeeId: collegue.employeeId } })).toBe(0);
    expect(await prisma.attendance.count({ where: { employeeId: collegue.employeeId } })).toBe(0);
  });

  it("confirmer un scan d'ARRIVÉE comme un départ → refus, rien d'écrit", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const arrivee = (await base(employeeId)).scans[0];

    await expect(confirmerDepartScan(prisma, { employeeId, scanId: arrivee.id, pauseMinutes: 0 })).rejects.toThrow("Ce départ est introuvable.");
    expect((await base(employeeId)).pointages[0].heureFin).toBeNull();
  });
});

describe("enregistrerScan — les refus communs (paie validée, congé approuvé)", () => {
  it("paie du mois validée → refus, rien d'écrit", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await prisma.payrollRun.create({ data: { mois: 3, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    await expect(
      enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: new Date("2026-03-10T07:00:00Z") }),
    ).rejects.toThrow("La paie du mois est validée : pointage impossible.");
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(0);
    expect(b.nbScans).toBe(0);
  });

  it("congé approuvé ce jour → refus, rien d'écrit", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await prisma.leaveRequest.create({
      data: {
        employeeId, type: "Congé annuel", dateDebut: new Date("2026-09-16"), dateFin: new Date("2026-09-16"),
        nbJours: 1, statut: "APPROUVE",
      },
    });
    await expect(
      enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: new Date("2026-09-16T07:00:00Z") }),
    ).rejects.toThrow("Vous êtes en congé approuvé aujourd'hui — pas de pointage.");
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(0);
    expect(b.nbScans).toBe(0);
  });
});

describe("actions serveur — session → employé lié → module", () => {
  it("scannerAffiche pointe TOUJOURS pour le salarié de la session, à l'heure du serveur", async () => {
    const moi = await nouvelEmploye();
    const collegue = await nouvelEmploye();
    A.user = { id: moi.userId, role: "EMPLOYE", nom: "Moi", employeeId: moi.employeeId };

    const avant = Date.now();
    // Un `employeeId` glissé dans l'entrée (appel forgé depuis le navigateur) n'a aucun effet.
    const entree = { code: CODE, position: AU_RESTAURANT, employeeId: collegue.employeeId };
    const r = await scannerAffiche(entree);
    expect(r).toMatchObject({ etat: "ARRIVEE" });

    const b = await base(moi.employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.scans[0].instant.getTime()).toBeGreaterThanOrEqual(avant - 1000);
    expect((await base(collegue.employeeId)).nbPointages).toBe(0);
  });

  it("compte non lié à une fiche employé → erreur lisible, rien d'écrit", async () => {
    const u = await prisma.user.create({ data: { email: "direction.sans.fiche@test.pef", nom: "Direction", role: "ADMIN" } });
    A.user = { id: u.id, role: "ADMIN", nom: "Direction", employeeId: null };
    const avant = await prisma.pointage.count();

    const r = await scannerAffiche({ code: CODE, position: AU_RESTAURANT });
    expect(r).toEqual({
      erreur: "Votre compte n'est pas encore lié à une fiche employé. Demandez à la Direction de faire le lien.",
    });
    expect(await prisma.pointage.count()).toBe(avant);
  });

  it("code faux par l'action → erreur lisible exacte (actionLisible), rien d'écrit", async () => {
    const moi = await nouvelEmploye();
    A.user = { id: moi.userId, role: "EMPLOYE", nom: "Moi", employeeId: moi.employeeId };
    expect(await scannerAffiche({ code: "faux", position: AU_RESTAURANT })).toEqual({ erreur: MESSAGE_AFFICHE });
    expect((await base(moi.employeeId)).nbScans).toBe(0);
  });

  it("confirmerDepart sur le scan d'un collègue → erreur lisible, rien d'écrit", async () => {
    const collegue = await nouvelEmploye();
    const moi = await nouvelEmploye();
    await enregistrerScan(prisma, { ...collegue, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { ...collegue, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    if (d.etat !== "DEPART_A_CONFIRMER") throw new Error(`état inattendu : ${d.etat}`);
    A.user = { id: moi.userId, role: "EMPLOYE", nom: "Moi", employeeId: moi.employeeId };

    expect(await confirmerDepart({ scanId: d.scanId, pauseMinutes: 30 })).toEqual({ erreur: "Ce départ est introuvable." });
    expect((await base(collegue.employeeId)).pointages[0].heureFin).toBeNull();
  });
});
