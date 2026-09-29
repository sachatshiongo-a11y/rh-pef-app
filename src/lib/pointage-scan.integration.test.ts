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

const { enregistrerScan, saisirPauseScan, MESSAGE_DEPART_AUTRE_JOUR, MESSAGE_PAUSE_DEJA_SAISIE, MESSAGE_DEPART_ANNULE } =
  await import("./pointage-scan");
const {
  annulerScan,
  POINTAGE_VALABLE,
  MESSAGE_DELAI_ANNULATION_PASSE,
  MESSAGE_POINTAGE_INTROUVABLE,
  MESSAGE_DEJA_ANNULE,
  MESSAGE_DEPART_A_ANNULER_D_ABORD,
  MESSAGE_JOURNEE_CORRIGEE,
} = await import("./pointage-annulation");
const { scannerAffiche, saisirMaPause, annulerPointage } = await import("@/app/pointage/actions");
const { resumeSemaineCourante } = await import("./pointage-suivi");
const { chargerPointageDuJour } = await import("@/app/(app)/pointer/pointage-du-jour");

const MESSAGE_AFFICHE = "Cette affiche n'est plus valable, demandez la nouvelle à la Direction.";
const CODE = "code-affiche-en-vigueur";
const RESTAURANT = { lat: -4.3217, lng: 15.3125 };
const AU_RESTAURANT: PositionScan = { lat: -4.3218, lng: 15.3126, precisionM: 20 };
const A_2_KM: PositionScan = { lat: -4.3217 + 0.018, lng: 15.3125, precisionM: 20 }; // ≈ 2 km au nord
const REFUSEE: PositionScan = { erreur: "REFUSEE" };
const SANS_POSITION: PositionScan = { erreur: "INDISPONIBLE" }; // 8 s dépassées, pas de GPS

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

    // Le perdant rejoue et trouve l'arrivée du gagnant : un scan répété, rien de plus.
    expect(resultats.map((r) => r.etat)).toEqual(["ARRIVEE", "ARRIVEE"]);
    expect(resultats.map((r) => (r.etat === "ARRIVEE" ? r.repete : null)).sort()).toEqual([false, true]);
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

/** Arrivée à ARRIVEE puis départ scanné à +`minutes` : la journée est close (pause par défaut). */
async function journeeScannee(minutes = 8 * 60, position: PositionScan = AU_RESTAURANT) {
  const qui = await nouvelEmploye();
  await enregistrerScan(prisma, { ...qui, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
  const d = await enregistrerScan(prisma, { ...qui, code: CODE, position, maintenant: plus(ARRIVEE, minutes) });
  if (d.etat !== "DEPART") throw new Error(`état inattendu : ${d.etat}`);
  return { ...qui, depart: d, instantDepart: plus(ARRIVEE, minutes) };
}

async function presences(employeeId: string) {
  const [heures, presence] = await Promise.all([
    prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId, date: JOUR } } }),
    prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: JOUR } } }),
  ]);
  return { heures: heures ? Number(heures.heuresTravaillees) : null, code: presence?.code ?? null };
}

describe("enregistrerScan — scan répété sous 10 minutes : rien de nouveau", () => {
  it("second scan à +3 min → l'arrivée réaffichée (repete), 0 départ, rien d'écrit", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const a = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const avant = await base(employeeId);
    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: A_2_KM, maintenant: plus(ARRIVEE, 3) });

    expect(r).toMatchObject({ etat: "ARRIVEE", repete: true, heure: ARRIVEE.toISOString(), verdict: { verdict: "AU_RESTAURANT" } });
    if (r.etat !== "ARRIVEE" || a.etat !== "ARRIVEE") return;
    expect(r.scanId).toBe(a.scanId);
    const apres = await base(employeeId);
    expect(apres.scans).toEqual(avant.scans);
    expect(apres.pointages).toEqual(avant.pointages);
  });

  it("borne : à 9 min 59 s encore répété ; à 10 min pile, c'est le départ", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const presque = await enregistrerScan(prisma, {
      employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: new Date(ARRIVEE.getTime() + 10 * 60_000 - 1000),
    });
    expect(presque).toMatchObject({ etat: "ARRIVEE", repete: true });
    expect((await base(employeeId)).nbDeparts).toBe(0);

    const pile = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 10) });
    expect(pile).toMatchObject({ etat: "DEPART", repete: false });
    expect((await base(employeeId)).nbDeparts).toBe(1);
  });

  it("rescan 2 min après le départ → CE départ réaffiché (même scanId), rien d'écrit", async () => {
    const j = await journeeScannee();
    const avant = await base(j.employeeId);
    const avantPresences = await presences(j.employeeId);
    const r = await enregistrerScan(prisma, { ...j, code: CODE, position: A_2_KM, maintenant: plus(j.instantDepart, 2) });

    expect(r).toMatchObject({ etat: "DEPART", repete: true, scanId: j.depart.scanId, heure: j.instantDepart.toISOString() });
    const apres = await base(j.employeeId);
    expect(apres.scans).toEqual(avant.scans);
    expect(apres.pointages).toEqual(avant.pointages);
    expect(await presences(j.employeeId)).toEqual(avantPresences);
  });

  it("rescan 11 min après le départ → « journée complète », avec sa pause, rien d'écrit", async () => {
    const j = await journeeScannee();
    const avant = await base(j.employeeId);
    const r = await enregistrerScan(prisma, { ...j, code: CODE, position: AU_RESTAURANT, maintenant: plus(j.instantDepart, 11) });

    expect(r).toEqual({
      etat: "COMPLETE",
      arriveeA: ARRIVEE.toISOString(),
      departA: j.instantDepart.toISOString(),
      pause: { minutes: 30, parDefaut: true },
    });
    const apres = await base(j.employeeId);
    expect(apres.scans).toEqual(avant.scans);
    expect(apres.pointages).toEqual(avant.pointages);
  });

  it("deux scans de départ simultanés → un seul scan DEPART, une seule clôture, le même scanId", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const scan = () => enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    const [r1, r2] = await ralentirInsertions("ScanPointage", employeeId, () => Promise.all([scan(), scan()]));

    expect(r1.etat).toBe("DEPART");
    expect(r2.etat).toBe("DEPART");
    if (r1.etat !== "DEPART" || r2.etat !== "DEPART") return;
    expect(r1.scanId).toBe(r2.scanId);
    expect([r1.repete, r2.repete].sort()).toEqual([false, true]);
    expect((await base(employeeId)).nbDeparts).toBe(1);
    expect(await prisma.journalAudit.count({ where: { entite: "Pointage", champ: "cloture", entiteId: (await base(employeeId)).pointages[0].id } })).toBe(1);
  });
});

describe("enregistrerScan — le départ clôt la journée, pause par défaut 30 min", () => {
  it("départ sans pause saisie → journée close à l'instant du SCAN, pause 30 min MARQUÉE « par défaut », heures aux présences", async () => {
    const j = await journeeScannee(8 * 60, A_2_KM);

    expect(j.depart).toMatchObject({
      etat: "DEPART",
      repete: false,
      heure: j.instantDepart.toISOString(),
      arriveeA: ARRIVEE.toISOString(),
      verdict: { verdict: "A_VERIFIER", motif: "LOIN" },
      pause: { minutes: 30, parDefaut: true },
      heures: 7.5,
      presencesEcrites: true,
      pauseModifiable: true,
      annulableMs: 5 * 60_000,
    });
    const b = await base(j.employeeId);
    expect(b.pointages[0]).toMatchObject({ heureFin: j.instantDepart, pauseMinutes: 30, pauseParDefaut: true });
    expect(b.scans[1]).toMatchObject({ id: j.depart.scanId, moment: "DEPART", instant: j.instantDepart, verdict: "A_VERIFIER", annuleLe: null });
    expect(await presences(j.employeeId)).toEqual({ heures: 7.5, code: "P" });
    // La clôture est journalisée avec l'état d'AVANT (rien) : c'est ce qui permet de la défaire.
    const journal = await prisma.journalAudit.findFirst({ where: { entite: "Pointage", entiteId: b.pointages[0].id, champ: "cloture" } });
    expect(JSON.parse(journal!.ancienneValeur!)).toEqual({ heures: null, code: null });
    expect(JSON.parse(journal!.nouvelleValeur!)).toMatchObject({ pauseMinutes: 30, pauseParDefaut: true, heures: 7.5, presencesEcrites: true, code: "P" });
  });

  it("sans position (8 s dépassées) → départ enregistré quand même, « à vérifier », position non transmise", async () => {
    const j = await journeeScannee(8 * 60, SANS_POSITION);
    expect(j.depart).toMatchObject({ etat: "DEPART", verdict: { verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE" } });
    const b = await base(j.employeeId);
    expect(b.scans[1]).toMatchObject({ verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE", latitude: null, verifieLe: null });
    expect(b.pointages[0].heureFin).toEqual(j.instantDepart);
  });

  it("une journée déjà close (et ses présences) n'est jamais changée par un nouveau scan", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    // Journée close autrement (ancien pointage) : 8 h → 16 h, pause 45 min, 7,25 h saisies.
    await prisma.pointage.create({
      data: { employeeId, date: JOUR, heureDebut: ARRIVEE, heureFin: plus(ARRIVEE, 8 * 60), pauseMinutes: 45, source: "APP" },
    });
    await prisma.overtimeEntry.create({ data: { employeeId, date: JOUR, heuresTravaillees: 7.25 } });
    const avant = await base(employeeId);

    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 9 * 60) });
    expect(r).toMatchObject({ etat: "COMPLETE", pause: { minutes: 45, parDefaut: false } });
    const apres = await base(employeeId);
    expect(apres.pointages).toEqual(avant.pointages);
    expect(apres.nbScans).toBe(0);
    expect(await presences(employeeId)).toEqual({ heures: 7.25, code: null });
  });

  it("un départ scanné AVANT la clôture automatique, jamais clos : le rescan le clôt à SON instant, pause par défaut", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const pointageId = (await base(employeeId)).pointages[0].id;
    const ancienDepart = await prisma.scanPointage.create({
      data: { pointageId, employeeId, moment: "DEPART", instant: plus(ARRIVEE, 8 * 60), verdict: "AU_RESTAURANT", distanceM: 10 },
    });

    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60 + 30) });
    expect(r).toMatchObject({ etat: "DEPART", scanId: ancienDepart.id, heure: plus(ARRIVEE, 8 * 60).toISOString(), heures: 7.5 });
    const b = await base(employeeId);
    expect(b.nbDeparts).toBe(1);
    expect(b.pointages[0]).toMatchObject({ heureFin: plus(ARRIVEE, 8 * 60), pauseMinutes: 30, pauseParDefaut: true });
  });
});

describe("saisirPauseScan — la pause, facultative, saisie après le départ", () => {
  it("pause saisie → c'est LA SIENNE qui compte : plus « par défaut », heures refaites, heure de fin inchangée", async () => {
    const j = await journeeScannee();
    const r = await saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 45, maintenant: plus(j.instantDepart, 3) });

    expect(r).toEqual({ heureFin: j.instantDepart.toISOString(), heures: 7.25, presencesEcrites: true, pauseMinutes: 45 });
    const b = await base(j.employeeId);
    expect(b.pointages[0]).toMatchObject({ heureFin: j.instantDepart, pauseMinutes: 45, pauseParDefaut: false });
    expect(await presences(j.employeeId)).toEqual({ heures: 7.25, code: "P" });
    expect(await prisma.journalAudit.count({ where: { entite: "Pointage", entiteId: b.pointages[0].id, champ: "pauseMinutes" } })).toBe(1);
  });

  it("une seconde saisie est refusée et ne réécrit rien", async () => {
    const j = await journeeScannee();
    await saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 45, maintenant: plus(j.instantDepart, 3) });
    await expect(
      saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 0, maintenant: plus(j.instantDepart, 4) }),
    ).rejects.toThrow(MESSAGE_PAUSE_DEJA_SAISIE);
    expect((await base(j.employeeId)).pointages[0].pauseMinutes).toBe(45);
    expect(await presences(j.employeeId)).toEqual({ heures: 7.25, code: "P" });
  });

  it("journée corrigée par la Direction (heures retouchées) → la pause saisie est refusée, la journée reste INTACTE", async () => {
    const j = await journeeScannee();
    // La Direction corrige les heures du jour dans Présences & heures.
    await prisma.overtimeEntry.update({ where: { employeeId_date: { employeeId: j.employeeId, date: JOUR } }, data: { heuresTravaillees: 6 } });
    const avant = await base(j.employeeId);

    await expect(
      saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 0, maintenant: plus(j.instantDepart, 3) }),
    ).rejects.toThrow("La Direction a déjà corrigé cette journée");
    expect((await base(j.employeeId)).pointages).toEqual(avant.pointages);
    expect(await presences(j.employeeId)).toEqual({ heures: 6, code: "P" });
  });

  it("journée corrigée par la Direction (code changé) → refus, rien réécrit", async () => {
    const j = await journeeScannee();
    await prisma.attendance.update({ where: { employeeId_date: { employeeId: j.employeeId, date: JOUR } }, data: { code: "N" } });
    await expect(
      saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 0, maintenant: plus(j.instantDepart, 3) }),
    ).rejects.toThrow("La Direction a déjà corrigé cette journée");
    expect(await presences(j.employeeId)).toEqual({ heures: 7.5, code: "N" });
  });

  it("un autre jour (Kinshasa) : refus, rien réécrit", async () => {
    const j = await journeeScannee();
    // 23 h 30 UTC le 15 = 0 h 30 le 16 à Kinshasa : même jour UTC, mais AUTRE jour à Kinshasa.
    await expect(
      saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 0, maintenant: new Date("2026-09-15T23:30:00Z") }),
    ).rejects.toThrow(MESSAGE_DEPART_AUTRE_JOUR);
    expect((await base(j.employeeId)).pointages[0]).toMatchObject({ pauseMinutes: 30, pauseParDefaut: true });
  });

  it("pause bornée à 600 min et jamais négative", async () => {
    const j = await journeeScannee(12 * 60);
    const r = await saisirPauseScan(prisma, { ...j, scanId: j.depart.scanId, pauseMinutes: 5000, maintenant: plus(j.instantDepart, 1) });
    expect(r.heures).toBe(2); // 12 h − 10 h
    expect((await base(j.employeeId)).pointages[0].pauseMinutes).toBe(600);
  });

  it("le départ d'un collègue, ou un scan d'ARRIVÉE → « introuvable », rien d'écrit", async () => {
    const collegue = await journeeScannee();
    const moi = await nouvelEmploye();
    await expect(
      saisirPauseScan(prisma, { ...moi, scanId: collegue.depart.scanId, pauseMinutes: 0, maintenant: plus(collegue.instantDepart, 1) }),
    ).rejects.toThrow("Ce départ est introuvable.");
    const arrivee = (await base(collegue.employeeId)).scans[0];
    await expect(
      saisirPauseScan(prisma, { ...collegue, scanId: arrivee.id, pauseMinutes: 0, maintenant: plus(collegue.instantDepart, 1) }),
    ).rejects.toThrow("Ce départ est introuvable.");
    expect((await base(collegue.employeeId)).pointages[0]).toMatchObject({ pauseMinutes: 30, pauseParDefaut: true });
  });

  it("un départ ancien jamais clos se clôt avec la pause SAISIE (pas « par défaut ») ; congé approuvé : rien aux présences", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const pointageId = (await base(employeeId)).pointages[0].id;
    const ancien = await prisma.scanPointage.create({
      data: { pointageId, employeeId, moment: "DEPART", instant: plus(ARRIVEE, 8 * 60), verdict: "AU_RESTAURANT", distanceM: 10 },
    });
    await prisma.leaveRequest.create({ data: { employeeId, type: "Congé annuel", dateDebut: JOUR, dateFin: JOUR, nbJours: 1, statut: "APPROUVE" } });

    const r = await saisirPauseScan(prisma, { employeeId, userId, scanId: ancien.id, pauseMinutes: 60, maintenant: plus(ARRIVEE, 8 * 60 + 5) });
    expect(r).toEqual({ heureFin: plus(ARRIVEE, 8 * 60).toISOString(), heures: 7, presencesEcrites: false, pauseMinutes: 60 });
    expect((await base(employeeId)).pointages[0]).toMatchObject({ heureFin: plus(ARRIVEE, 8 * 60), pauseMinutes: 60, pauseParDefaut: false });
    expect(await presences(employeeId)).toEqual({ heures: null, code: null });
  });
});

describe("annulerScan — « Annuler ce pointage » : 5 minutes, le propriétaire seul, rien d'effacé", () => {
  it("arrivée annulée dans les 5 min → scan CONSERVÉ et marqué, journalisé ; le pointage disparaît des écrans", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const a = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    if (a.etat !== "ARRIVEE") throw new Error("arrivée attendue");

    const r = await annulerScan(prisma, { employeeId, userId, scanId: a.scanId, maintenant: plus(ARRIVEE, 4) });
    expect(r).toEqual({ moment: "ARRIVEE", heure: ARRIVEE.toISOString() });
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1); // rien n'est supprimé
    expect(b.nbScans).toBe(1);
    expect(b.scans[0]).toMatchObject({ id: a.scanId, annuleLe: plus(ARRIVEE, 4), annuleParId: userId, instant: ARRIVEE });
    const journal = await prisma.journalAudit.findMany({ where: { entite: "ScanPointage", entiteId: a.scanId, champ: "annuleLe" } });
    expect(journal).toHaveLength(1);
    expect(journal[0].userId).toBe(userId);
    // Ignoré par les lectures : pointage du jour, Suivi, compteur de la semaine, grille Présences.
    expect(await prisma.pointage.count({ where: { AND: [{ employeeId }, POINTAGE_VALABLE] } })).toBe(0);
  });

  it("arrivée annulée puis rescannée → l'arrivée est REFAITE (nouvelle heure), l'ancienne reste en base, annulée", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const a = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    if (a.etat !== "ARRIVEE") throw new Error("arrivée attendue");
    await annulerScan(prisma, { employeeId, userId, scanId: a.scanId, maintenant: plus(ARRIVEE, 1) });

    const r = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 2) });
    expect(r).toMatchObject({ etat: "ARRIVEE", repete: false, heure: plus(ARRIVEE, 2).toISOString() });
    const b = await base(employeeId);
    expect(b.nbPointages).toBe(1);
    expect(b.pointages[0].heureDebut).toEqual(plus(ARRIVEE, 2));
    expect(b.scans.map((s) => [s.moment, s.annuleLe !== null])).toEqual([["ARRIVEE", true], ["ARRIVEE", false]]);
    expect(await prisma.pointage.count({ where: { AND: [{ employeeId }, POINTAGE_VALABLE] } })).toBe(1);
  });

  it("refusée après 5 minutes : rien ne change", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const a = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    if (a.etat !== "ARRIVEE") throw new Error("arrivée attendue");
    const avant = await base(employeeId);
    await expect(
      annulerScan(prisma, { employeeId, userId, scanId: a.scanId, maintenant: new Date(ARRIVEE.getTime() + 5 * 60_000 + 1000) }),
    ).rejects.toThrow(MESSAGE_DELAI_ANNULATION_PASSE);
    expect(await base(employeeId)).toEqual(avant);
  });

  it("refusée pour un AUTRE compte (même message qu'un scan inexistant) : rien ne change", async () => {
    const proprietaire = await nouvelEmploye();
    const autre = await nouvelEmploye();
    const a = await enregistrerScan(prisma, { ...proprietaire, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    if (a.etat !== "ARRIVEE") throw new Error("arrivée attendue");
    const avant = await base(proprietaire.employeeId);
    await expect(annulerScan(prisma, { ...autre, scanId: a.scanId, maintenant: plus(ARRIVEE, 1) })).rejects.toThrow(MESSAGE_POINTAGE_INTROUVABLE);
    await expect(annulerScan(prisma, { ...autre, scanId: "inexistant", maintenant: plus(ARRIVEE, 1) })).rejects.toThrow(MESSAGE_POINTAGE_INTROUVABLE);
    expect(await base(proprietaire.employeeId)).toEqual(avant);
  });

  it("déjà annulé → refus ; une arrivée suivie d'un départ ne s'annule pas avant le départ", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    const a = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    if (a.etat !== "ARRIVEE") throw new Error("arrivée attendue");
    await annulerScan(prisma, { employeeId, userId, scanId: a.scanId, maintenant: plus(ARRIVEE, 1) });
    await expect(annulerScan(prisma, { employeeId, userId, scanId: a.scanId, maintenant: plus(ARRIVEE, 2) })).rejects.toThrow(MESSAGE_DEJA_ANNULE);

    // Arrivée refaite à +2 min, départ à +12 min : annuler l'ARRIVÉE (à +4 min du scan) est refusé.
    const a2 = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 2) });
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 12) });
    if (a2.etat !== "ARRIVEE") throw new Error("arrivée attendue");
    await expect(annulerScan(prisma, { employeeId, userId, scanId: a2.scanId, maintenant: plus(ARRIVEE, 6) })).rejects.toThrow(
      MESSAGE_DEPART_A_ANNULER_D_ABORD,
    );
  });

  it("départ annulé → journée ROUVERTE, présences rendues à leur état d'avant, scan conservé ; le rescan refait le départ", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    // Avant le départ, la Direction avait pré-rempli le jour : P + 9 h planifiées.
    await prisma.attendance.create({ data: { employeeId, date: JOUR, code: "P" } });
    await prisma.overtimeEntry.create({ data: { employeeId, date: JOUR, heuresTravaillees: 9 } });
    await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: ARRIVEE });
    const d = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 6 * 60) });
    if (d.etat !== "DEPART") throw new Error("départ attendu");
    expect(await presences(employeeId)).toEqual({ heures: 5.5, code: "P" });

    const r = await annulerScan(prisma, { employeeId, userId, scanId: d.scanId, maintenant: plus(ARRIVEE, 6 * 60 + 2) });
    expect(r).toEqual({ moment: "DEPART", heure: plus(ARRIVEE, 6 * 60).toISOString() });
    const b = await base(employeeId);
    expect(b.pointages[0]).toMatchObject({ heureFin: null, pauseMinutes: 0, pauseParDefaut: false, heureDebut: ARRIVEE });
    expect(b.scans[1]).toMatchObject({ id: d.scanId, annuleLe: plus(ARRIVEE, 6 * 60 + 2), annuleParId: userId });
    expect(await presences(employeeId)).toEqual({ heures: 9, code: "P" }); // l'état d'avant, pas effacé

    // La pause ne se saisit plus sur un départ annulé.
    await expect(
      saisirPauseScan(prisma, { employeeId, userId, scanId: d.scanId, pauseMinutes: 10, maintenant: plus(ARRIVEE, 6 * 60 + 3) }),
    ).rejects.toThrow(MESSAGE_DEPART_ANNULE);

    // Le vrai départ, plus tard : un NOUVEAU départ (le scan annulé ne compte plus).
    const vrai = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: AU_RESTAURANT, maintenant: plus(ARRIVEE, 8 * 60) });
    expect(vrai).toMatchObject({ etat: "DEPART", repete: false, heure: plus(ARRIVEE, 8 * 60).toISOString(), heures: 7.5 });
    expect((await base(employeeId)).nbDeparts).toBe(2);
    expect(await presences(employeeId)).toEqual({ heures: 7.5, code: "P" });
  });

  it("départ annulé sans rien avant : heures et présence créées par la clôture sont retirées", async () => {
    const j = await journeeScannee();
    await annulerScan(prisma, { ...j, scanId: j.depart.scanId, maintenant: plus(j.instantDepart, 1) });
    expect(await presences(j.employeeId)).toEqual({ heures: null, code: null });
  });

  it("départ : annulation refusée si la Direction a corrigé la journée entre-temps — ses heures restent", async () => {
    const j = await journeeScannee();
    await prisma.overtimeEntry.update({ where: { employeeId_date: { employeeId: j.employeeId, date: JOUR } }, data: { heuresTravaillees: 6 } });
    const avant = await base(j.employeeId);
    await expect(annulerScan(prisma, { ...j, scanId: j.depart.scanId, maintenant: plus(j.instantDepart, 1) })).rejects.toThrow(
      MESSAGE_JOURNEE_CORRIGEE,
    );
    expect(await base(j.employeeId)).toEqual(avant);
    expect(await presences(j.employeeId)).toEqual({ heures: 6, code: "P" });
  });

  it("les lecteurs ignorent ce qui est annulé : compteur de la semaine et « Pointer » (pointage du jour)", async () => {
    const { employeeId, userId } = await nouvelEmploye();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(plus(ARRIVEE, 1));
    try {
      const avantSemaine = await resumeSemaineCourante(prisma);
      const a = await enregistrerScan(prisma, { employeeId, userId, code: CODE, position: A_2_KM, maintenant: ARRIVEE });
      if (a.etat !== "ARRIVEE") throw new Error("arrivée attendue");
      expect((await chargerPointageDuJour(employeeId)).pointage).not.toBeNull();
      expect((await resumeSemaineCourante(prisma)).total).toBe(avantSemaine.total + 1);

      await annulerScan(prisma, { employeeId, userId, scanId: a.scanId, maintenant: plus(ARRIVEE, 1) });
      expect((await chargerPointageDuJour(employeeId)).pointage).toBeNull();
      expect(await resumeSemaineCourante(prisma)).toEqual(avantSemaine);
    } finally {
      vi.useRealTimers();
    }
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

  it("saisirMaPause et annulerPointage sur le scan d'un collègue → erreur lisible, rien d'écrit", async () => {
    const collegue = await nouvelEmploye();
    const moi = await nouvelEmploye();
    // Maintenant (heure réelle) : les actions prennent l'heure du serveur.
    const maintenant = new Date();
    await enregistrerScan(prisma, { ...collegue, code: CODE, position: AU_RESTAURANT, maintenant: plus(maintenant, -12) });
    const d = await enregistrerScan(prisma, { ...collegue, code: CODE, position: AU_RESTAURANT, maintenant: plus(maintenant, -1) });
    if (d.etat !== "DEPART") throw new Error(`état inattendu : ${d.etat}`);
    const avant = await base(collegue.employeeId);
    A.user = { id: moi.userId, role: "EMPLOYE", nom: "Moi", employeeId: moi.employeeId };

    expect(await saisirMaPause({ scanId: d.scanId, pauseMinutes: 0 })).toEqual({ erreur: "Ce départ est introuvable." });
    expect(await annulerPointage({ scanId: d.scanId })).toEqual({ erreur: MESSAGE_POINTAGE_INTROUVABLE });
    expect(await base(collegue.employeeId)).toEqual(avant);

    // Le propriétaire, lui, annule par l'action — à l'heure du serveur, dans les 5 minutes.
    A.user = { id: collegue.userId, role: "EMPLOYE", nom: "Collègue", employeeId: collegue.employeeId };
    expect(await annulerPointage({ scanId: d.scanId })).toMatchObject({ moment: "DEPART" });
    expect((await base(collegue.employeeId)).pointages[0].heureFin).toBeNull();
  });
});
