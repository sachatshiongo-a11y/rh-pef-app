import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// L'attestation de paie mensuelle exige une ligne VALIDE ou PAYE (spec 2026-09-28, §4.3) : un
// brouillon n'est pas un salaire perçu, il ne s'atteste pas.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => ({ id: "dir", role: "ADMIN", nom: "Direction" }),
  requireRole: () => {},
  estRH: () => true,
}));
vi.mock("@/lib/entreprise", () => ({ chargerEntreprise: async () => ({ entreprise: undefined, logo: undefined, signature: null }) }));
vi.mock("@/lib/pdf/fonts", () => ({ renderPdfBuffer: async () => Buffer.from("%PDF-PAIE"), registerPdfFonts: () => {} }));

const { GET } = await import("./route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;
const lignes: Record<string, string> = {};

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  empId = (await prisma.employee.create({
    data: { matricule: "AP01-PEF", nom: "Paie Test", sexe: "F", etatCivil: "C", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2024-01-01"), contrat: "CDI" },
  })).id;
  for (const [mois, statut] of [[7, "PAYE"], [8, "VALIDE"], [9, "PAS_VALIDE"]] as const) {
    const run = await prisma.payrollRun.create({ data: { mois, annee: 2026, tauxChangeUtilise: 2800 } });
    lignes[statut] = (await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId: empId, statutPaiement: statut, transportUSD: 15, salBrutUSD: 330, cnssSalarieUSD: 15, netImposableUSD: 285,
        iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 305, salNetCDF: 854000, cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
      },
    })).id;
  }
}, 180_000);
afterAll(async () => { await fermer?.(); });

const demander = (ligneId: string) =>
  GET(new Request(`http://local/employes/${empId}/attestation-paie/${ligneId}`), { params: Promise.resolve({ id: empId, ligneId }) });

describe("attestation de paie mensuelle", () => {
  it("ligne VALIDE ou PAYE : le PDF", async () => {
    expect((await demander(lignes.VALIDE)).status).toBe(200);
    expect((await demander(lignes.PAYE)).status).toBe(200);
  });
  it("ligne non validée : refus lisible, aucun PDF", async () => {
    const res = await demander(lignes.PAS_VALIDE);
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("Cette paie n'est pas encore validée : elle ne peut pas être attestée.");
  });
});
