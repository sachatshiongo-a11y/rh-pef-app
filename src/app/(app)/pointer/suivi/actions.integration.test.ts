import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// `marquerVerifies`, contre une VRAIE base (Postgres embarqué) : la garde de rôle, le périmètre
// EXACT des scans touchés (ni ceux déjà AU_RESTAURANT, ni ceux déjà vérifiés, ni ceux d'un
// pointage non coché) et l'idempotence. Base relue après chaque refus, comme
// `pointage-scan.integration.test.ts` et `espace/signature-actions.integration.test.ts`.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as Role, nom: "Testeur", employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, p) => {
        const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
      },
    }
  ),
}));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    verifySession: async () => A.user,
    requireRole: actual.requireRole, // vrai comportement : c'est LUI qu'on falsifie/teste ici
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { marquerVerifies } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let seq = 0;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma;
  fermer = db.fermer;
  H.client = prisma;
});

afterAll(async () => {
  await fermer();
});

beforeEach(async () => {
  // Un VRAI compte ADMIN (la contrainte de clé étrangère `verifieParId` l'exige) — les tests de
  // rôle ci-dessous remplacent A.user par leur propre compte quand ils testent un autre rôle.
  const id = await nouvelUtilisateur("ADMIN");
  A.user = { id, role: "ADMIN", nom: "Testeur", employeeId: null };
});

async function nouvelEmploye(): Promise<string> {
  seq += 1;
  const emp = await prisma.employee.create({
    data: {
      matricule: `MV${String(seq).padStart(2, "0")}-PEF`, nom: `Salarié ${seq}`, sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  return emp.id;
}

async function nouvelUtilisateur(role: Role): Promise<string> {
  seq += 1;
  const u = await prisma.user.create({ data: { email: `direction.${seq}.mv@test.pef`, nom: `Direction ${seq}`, role } });
  return u.id;
}

/** Un pointage du jour donné avec UN scan ARRIVEE, au verdict et à l'état de vérification donnés. */
async function pointageAvecScan(opts: {
  jourISO: string;
  verdict: "AU_RESTAURANT" | "A_VERIFIER";
  dejaVerifie?: boolean;
}): Promise<{ pointageId: string; scanId: string }> {
  const employeeId = await nouvelEmploye();
  const date = new Date(`${opts.jourISO}T00:00:00Z`);
  const pointage = await prisma.pointage.create({
    data: { employeeId, date, heureDebut: new Date(`${opts.jourISO}T07:00:00Z`), source: "QR" },
  });
  const scan = await prisma.scanPointage.create({
    data: {
      pointageId: pointage.id, employeeId, moment: "ARRIVEE", instant: pointage.heureDebut,
      verdict: opts.verdict, motif: opts.verdict === "A_VERIFIER" ? "LOIN" : null,
      distanceM: opts.verdict === "A_VERIFIER" ? 2000 : 50,
      ...(opts.dejaVerifie ? { verifieParId: await nouvelUtilisateur("ADMIN"), verifieLe: new Date("2020-01-01") } : {}),
    },
  });
  return { pointageId: pointage.id, scanId: scan.id };
}

/** Ce que la base contient pour un scan — relu après chaque appel. */
async function scan(id: string) {
  return prisma.scanPointage.findUniqueOrThrow({ where: { id } });
}

describe("marquerVerifies — rôle", () => {
  it.each<Role>(["EMPLOYE", "VIEWER", "STOCK", "COMPTA"])("%s refusé, rien n'est écrit", async (role) => {
    const { pointageId, scanId } = await pointageAvecScan({ jourISO: "2026-09-16", verdict: "A_VERIFIER" });
    const userId = await nouvelUtilisateur(role);
    A.user = { id: userId, role, nom: "Testeur", employeeId: null };

    const r = await marquerVerifies([pointageId]);
    expect(r).toEqual({ erreur: "Accès refusé : rôle insuffisant." });

    const s = await scan(scanId);
    expect(s.verifieLe).toBeNull();
    expect(s.verifieParId).toBeNull();
    expect(await prisma.journalAudit.count({ where: { entiteId: scanId } })).toBe(0);
  });

  it.each<Role>(["ADMIN", "MANAGER"])("%s autorisé", async (role) => {
    const { pointageId, scanId } = await pointageAvecScan({ jourISO: "2026-09-16", verdict: "A_VERIFIER" });
    const userId = await nouvelUtilisateur(role);
    A.user = { id: userId, role, nom: "Testeur", employeeId: null };

    const r = await marquerVerifies([pointageId]);
    expect(r).toEqual({ scansVerifies: 1 });

    const s = await scan(scanId);
    expect(s.verifieParId).toBe(userId);
    expect(s.verifieLe).not.toBeNull();
  });
});

describe("marquerVerifies — périmètre exact", () => {
  it("ne touche que les scans A_VERIFIER non vérifiés des pointages cochés", async () => {
    const auVerifier = await pointageAvecScan({ jourISO: "2026-09-16", verdict: "A_VERIFIER" });
    const dejaAuRestaurant = await pointageAvecScan({ jourISO: "2026-09-16", verdict: "AU_RESTAURANT" });
    const dejaVerifie = await pointageAvecScan({ jourISO: "2026-09-16", verdict: "A_VERIFIER", dejaVerifie: true });
    const nonCoche = await pointageAvecScan({ jourISO: "2026-09-16", verdict: "A_VERIFIER" }); // pas dans la liste

    const r = await marquerVerifies([auVerifier.pointageId, dejaAuRestaurant.pointageId, dejaVerifie.pointageId]);
    expect(r).toEqual({ scansVerifies: 1 }); // seul `auVerifier` avait quelque chose à vérifier

    expect((await scan(auVerifier.scanId)).verifieLe).not.toBeNull();
    expect((await scan(dejaAuRestaurant.scanId)).verifieLe).toBeNull(); // rien à vérifier : jamais touché
    expect((await scan(dejaVerifie.scanId)).verifieLe).toEqual(new Date("2020-01-01")); // déjà vérifié : inchangé (idempotent)
    expect((await scan(nonCoche.scanId)).verifieLe).toBeNull(); // pas coché : jamais touché

    expect(await prisma.journalAudit.count({ where: { entiteId: auVerifier.scanId } })).toBe(1);
  });

  it("deuxième appel sur les mêmes pointages = 0, sans erreur (idempotent)", async () => {
    const { pointageId, scanId } = await pointageAvecScan({ jourISO: "2026-09-17", verdict: "A_VERIFIER" });

    const premier = await marquerVerifies([pointageId]);
    expect(premier).toEqual({ scansVerifies: 1 });
    const verifieLeApresPremier = (await scan(scanId)).verifieLe;

    const second = await marquerVerifies([pointageId]);
    expect(second).toEqual({ scansVerifies: 0 });
    expect((await scan(scanId)).verifieLe).toEqual(verifieLeApresPremier); // pas réécrit
  });

  it("liste vide → 0, sans erreur", async () => {
    expect(await marquerVerifies([])).toEqual({ scansVerifies: 0 });
  });
});
