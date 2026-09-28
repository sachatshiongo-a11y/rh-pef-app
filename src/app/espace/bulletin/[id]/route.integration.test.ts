import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PaymentStatus, PrismaClient, Role } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

/**
 * « MA PAIE » NE MONTRE QUE DES BULLETINS ARRÊTÉS PAR LA DIRECTION.
 *
 * Avant le 2026-09-28, un brouillon (PAS_VALIDE) — recalculé à chaque saisie de présence — était
 * proposé au salarié dans « Ma paie » et servi par `/espace/bulletin/[id]`. Désormais :
 *  - la route sert SES bulletins VALIDÉS ou PAYÉS, refuse (403, sans PDF) un brouillon et le
 *    bulletin d'un collègue ;
 *  - « Ma paie » ne propose le lien que dans ce cas (`bulletinConsultableDuMois`, sa requête).
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
type Compte = { id: string; email: string; nom: string; role: Role; accesStock: boolean; employeeId: string | null };
const A = vi.hoisted(() => ({ user: null as unknown as Compte }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));
vi.mock("@/lib/storage", () => ({ lireFichier: async () => null, televerserFichier: async (c: string) => `/fichiers/${c}` }));

const { GET } = await import("./route");
const { bulletinConsultableDuMois } = await import("@/lib/bulletin-salarie");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let moiId: string;
let collegueId: string;
const lignes: Record<string, string> = {}; // clé « <qui>-<mois> » → id de ligne

// Juillet : VALIDÉ ; août : PAYÉ ; septembre : brouillon (PAS_VALIDE).
const MOIS: [number, PaymentStatus][] = [[7, "VALIDE"], [8, "PAYE"], [9, "PAS_VALIDE"]];

const appeler = (id: string) => GET(new Request(`http://localhost/espace/bulletin/${id}`), { params: Promise.resolve({ id }) });
const debut = async (r: Response) => Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString("latin1");

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9, espaceEmployeActif: true } });

  const emp = (matricule: string, nom: string) =>
    prisma.employee.create({
      data: {
        matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine",
        categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
      },
    });
  moiId = (await emp("MB01-PEF", "Moi Bulletin")).id;
  collegueId = (await emp("CB01-PEF", "Collègue Bulletin")).id;

  for (const [mois, statut] of MOIS) {
    const run = await prisma.payrollRun.create({ data: { mois, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
    for (const [qui, employeeId] of [["moi", moiId], ["collegue", collegueId]] as const) {
      const l = await prisma.payrollLine.create({
        data: {
          payrollRunId: run.id, employeeId, statutPaiement: statut,
          transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
          iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000,
          cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
        },
      });
      lignes[`${qui}-${mois}`] = l.id;
    }
  }
  A.user = { id: "u-moi", email: "moi@test.pef", nom: "Moi", role: "EMPLOYE", accesStock: false, employeeId: moiId };
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("/espace/bulletin/[id] : ses bulletins VALIDÉS ou PAYÉS, rien d'autre", () => {
  it("VALIDÉ : servi", async () => {
    const r = await appeler(lignes["moi-7"]);
    expect(r.status).toBe(200);
    expect(await debut(r)).toBe("%PDF-");
  }, 60_000);

  it("PAYÉ : servi", async () => {
    const r = await appeler(lignes["moi-8"]);
    expect(r.status).toBe(200);
    expect(await debut(r)).toBe("%PDF-");
  }, 60_000);

  it("brouillon (PAS_VALIDE) : refusé, sans PDF", async () => {
    const r = await appeler(lignes["moi-9"]);
    expect(r.status).toBe(403);
    expect(await debut(r)).not.toBe("%PDF-");
  });

  it("bulletin VALIDÉ d'un collègue : refusé", async () => {
    const r = await appeler(lignes["collegue-7"]);
    expect(r.status).toBe(403);
    expect(await debut(r)).not.toBe("%PDF-");
  });
});

describe("« Ma paie » ne propose le lien que pour un bulletin VALIDÉ ou PAYÉ", () => {
  it("juillet (VALIDÉ) et août (PAYÉ) : lien proposé, vers SA ligne", async () => {
    expect(await bulletinConsultableDuMois(prisma, moiId, 7, 2026)).toEqual({ id: lignes["moi-7"], statutPaiement: "VALIDE" });
    expect(await bulletinConsultableDuMois(prisma, moiId, 8, 2026)).toEqual({ id: lignes["moi-8"], statutPaiement: "PAYE" });
  });

  it("septembre (brouillon) : aucun lien", async () => {
    expect(await bulletinConsultableDuMois(prisma, moiId, 9, 2026)).toBeNull();
  });

  it("mois sans paie calculée : aucun lien", async () => {
    expect(await bulletinConsultableDuMois(prisma, moiId, 10, 2026)).toBeNull();
  });

  it("la page « Ma paie » passe bien par cette requête (et nulle autre pour le lien)", () => {
    const page = fs.readFileSync(path.join(__dirname, "../../paie/page.tsx"), "utf8");
    expect(page).toContain("bulletinConsultableDuMois(prisma, s.employeeId, mois, annee)");
    expect(page).not.toMatch(/payrollLine\.find/);
  });
});
