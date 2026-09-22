import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Côté Direction : c'est `documentSignable` (relu en base) qui fournit l'`employeeId` écrit dans
// la signature — jamais l'id du compte Direction (qui va dans `presenteParId`). Le mode n'est
// JAMAIS un paramètre de l'action : même si l'appelant en passe un, la ligne reste PRESENTIEL.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction Test" } }));
const S = vi.hoisted(() => ({ traceUrl: "/fichiers/signatures/test/trace.png" }));
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
  requireRole: (u: { role: string }, allowed: string[]) => {
    if (!allowed.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant.");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/storage", () => ({ televerserFichier: async () => S.traceUrl }));
vi.mock("@/lib/notifications", () => ({
  creerNotification: async () => {},
  notifierSalarie: async () => {},
  compteSalarieDe: async () => null,
}));

const { faireSignerDocument } = await import("./signature-actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
let adminId: string;
let ligneValideId: string;

const ENTETE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_VALIDE = `data:image/png;base64,${Buffer.concat([ENTETE_PNG, Buffer.alloc(200, 0)]).toString("base64")}`;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  const emp = await prisma.employee.create({
    data: {
      matricule: "SD01-PEF", nom: "Salarié Direction", sexe: "M", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  empId = emp.id;

  const admin = await prisma.user.create({ data: { email: "direction.signature@test.pef", nom: "Direction Test", role: "ADMIN" } });
  adminId = admin.id;
  A.user.id = adminId;

  const run = await prisma.payrollRun.create({ data: { mois: 8, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  ligneValideId = (await prisma.payrollLine.create({
    data: {
      payrollRunId: run.id, employeeId: empId, statutPaiement: "VALIDE",
      transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
      iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000,
      cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
    },
  })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("faireSignerDocument — Direction", () => {
  it("un compte VIEWER est refusé", async () => {
    A.user.role = "VIEWER";
    const res = await faireSignerDocument("BULLETIN", ligneValideId, PNG_VALIDE);
    expect(res).toMatchObject({ erreur: expect.any(String) });

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(sig).toBeNull();
    A.user.role = "ADMIN";
  });

  it("la Direction fait signer → mode PRESENTIEL, presenteParId = l'utilisateur connecté", async () => {
    const res = await faireSignerDocument("BULLETIN", ligneValideId, PNG_VALIDE);
    expect(res).toBeUndefined();

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "BULLETIN", cibleId: ligneValideId } },
    });
    expect(sig).not.toBeNull();
    expect(sig?.mode).toBe("PRESENTIEL");
    expect(sig?.presenteParId).toBe(adminId);
    expect(sig?.employeeId).toBe(empId);
    expect(sig?.traceUrl).toBe(S.traceUrl);
  });

  it("le mode envoyé par le client est ignoré → même si l'appel passe un mode, la ligne est PRESENTIEL", async () => {
    // Nouveau document signable (le précédent est déjà signé) : un contrat actif du même salarié.
    const contrat = await prisma.contrat.create({
      data: { employeeId: empId, type: "CDI", dateDebut: new Date("2025-01-01"), heuresHebdo: 48, salaireMensuel: 300, devise: "USD", poste: "Test", statut: "ACTIF" },
    });

    // `faireSignerDocument` ne déclare pas de 4e paramètre : un appelant qui en passe un est ignoré
    // par JavaScript (les paramètres surnuméraires ne sont jamais lus), ce que ce test vérifie
    // au niveau du résultat écrit en base.
    const res = await (faireSignerDocument as unknown as (c: string, id: string, p: string, mode: string) => Promise<unknown>)(
      "CONTRAT", contrat.id, PNG_VALIDE, "ESPACE_SALARIE"
    );
    expect(res).toBeUndefined();

    const sig = await prisma.signatureElectronique.findUnique({
      where: { cible_cibleId: { cible: "CONTRAT", cibleId: contrat.id } },
    });
    expect(sig?.mode).toBe("PRESENTIEL");
    expect(sig?.presenteParId).toBe(adminId);
  });
});
