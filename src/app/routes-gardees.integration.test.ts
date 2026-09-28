import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

/**
 * UN SALARIÉ CONNECTÉ NE TÉLÉCHARGE PAS LA PAIE DE LA BRIGADE.
 *
 * Faille mesurée le 2026-09-28 : les Route Handlers de l'espace RH n'héritent pas de la garde du
 * layout (`estRH`) et n'appelaient que `verifySession()`. Un compte salarié (EMPLOYE) ou un
 * magasinier (STOCK relié à sa fiche) obtenait le ZIP de TOUS les bulletins du mois, n'importe quel
 * bulletin, la fiche d'un collègue, le bordereau des déclarations.
 *
 * Ici, base réelle, VRAIES routes, VRAIE garde (`lib/garde-route.ts` + `lib/espaces.ts`) : seule la
 * session est simulée. Chaque refus est vérifié sur le CONTENU (ni PDF, ni ZIP), pas seulement le
 * statut ; et la Direction obtient bien le fichier, sans quoi un 403 « partout » passerait pour
 * une protection.
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

const { GET: bulletinsZip } = await import("./(app)/paie/bulletins-zip/route");
const { GET: bulletin } = await import("./(app)/paie/bulletin/[id]/route");
const { GET: ficheEmploye } = await import("./(app)/employes/[id]/fiche/route");
const { GET: declarationsExport } = await import("./(app)/declarations/export/route");

const MOIS = 7;
const ANNEE = 2026;

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let salarieId: string; // l'employé derrière le compte EMPLOYE
let magasinierId: string; // l'employé derrière le compte STOCK
let collegueId: string; // la cible : un autre salarié
let ligneCollegueId: string;

const compte = (role: Role, employeeId: string | null, accesStock = false): Compte =>
  ({ id: `u-${role}-${employeeId ?? "x"}`, email: `${role}@test.pef`, nom: role, role, accesStock, employeeId });

async function corps(r: Response) {
  const b = Buffer.from(await r.arrayBuffer());
  return { b, debut: b.subarray(0, 5).toString("latin1") };
}

async function refuse(r: Response) {
  expect(r.status).toBe(403);
  expect(r.headers.get("Content-Type") ?? "").not.toMatch(/pdf|zip|spreadsheet|octet/);
  expect(r.headers.get("Content-Disposition")).toBeNull();
  const { debut } = await corps(r);
  expect(debut).not.toMatch(/^%PDF|^PK/);
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, ANNEE);
  await prisma.config.create({
    data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: ANNEE, moisCourant: MOIS, espaceEmployeActif: true },
  });

  const emp = (matricule: string, nom: string) =>
    prisma.employee.create({
      data: {
        matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine",
        categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
      },
    });
  salarieId = (await emp("SE01-PEF", "Salariée Curieuse")).id;
  magasinierId = (await emp("MA01-PEF", "Magasinier Curieux")).id;
  collegueId = (await emp("CO01-PEF", "Collègue Ciblée")).id;

  const run = await prisma.payrollRun.create({ data: { mois: MOIS, annee: ANNEE, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  for (const employeeId of [salarieId, magasinierId, collegueId]) {
    const l = await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId, statutPaiement: "VALIDE",
        transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
        iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 812000,
        cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 940800,
      },
    });
    if (employeeId === collegueId) ligneCollegueId = l.id;
  }
}, 120_000);

afterAll(async () => { await fermer?.(); });

const appels = {
  "paie/bulletins-zip": () => bulletinsZip(new Request("http://localhost/paie/bulletins-zip")),
  "paie/bulletin/[id]": () =>
    bulletin(new Request(`http://localhost/paie/bulletin/${ligneCollegueId}`), { params: Promise.resolve({ id: ligneCollegueId }) }),
  "employes/[id]/fiche": () =>
    ficheEmploye(new Request(`http://localhost/employes/${collegueId}/fiche`), { params: Promise.resolve({ id: collegueId }) }),
  "declarations/export": () =>
    declarationsExport(new Request(`http://localhost/declarations/export?mois=${MOIS}&annee=${ANNEE}`)),
} as const;

describe("les comptes sans droit RH reçoivent 403, jamais le fichier", () => {
  const sansRH: [string, () => Compte][] = [
    ["EMPLOYE relié à sa fiche", () => compte("EMPLOYE", salarieId)],
    ["EMPLOYE avec accès Stock", () => compte("EMPLOYE", salarieId, true)],
    ["STOCK relié à sa fiche (magasinier)", () => compte("STOCK", magasinierId)],
    ["STOCK sans fiche", () => compte("STOCK", null)],
    ["COMPTA", () => compte("COMPTA", null)],
  ];
  for (const [libelle, qui] of sansRH) {
    for (const [route, appeler] of Object.entries(appels)) {
      it(`${libelle} → ${route}`, async () => {
        A.user = qui();
        await refuse(await appeler());
      });
    }
  }
});

describe("la Direction et la RH obtiennent bien les fichiers (contrôle positif)", () => {
  for (const role of ["ADMIN", "VIEWER"] as const) {
    it(`${role} → paie/bulletins-zip : un ZIP`, async () => {
      A.user = compte(role, null);
      const r = await appels["paie/bulletins-zip"]();
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("application/zip");
      expect((await corps(r)).debut).toMatch(/^PK/);
    }, 60_000);

    for (const route of ["paie/bulletin/[id]", "employes/[id]/fiche", "declarations/export"] as const) {
      it(`${role} → ${route} : un PDF`, async () => {
        A.user = compte(role, null);
        const r = await appels[route]();
        expect(r.status).toBe(200);
        expect(r.headers.get("Content-Type")).toBe("application/pdf");
        expect((await corps(r)).debut).toBe("%PDF-");
      }, 60_000);
    }
  }
});

/**
 * Balayage : TOUTES les routes de chaque espace, appelées pour de vrai par des comptes qui n'y ont
 * pas droit. La garde étant la première instruction, le refus tombe avant toute lecture — les
 * paramètres factices ne sont jamais consultés.
 */
describe("balayage : chaque route refuse les comptes étrangers à son espace", () => {
  const APP = __dirname;
  const routesDe = (dossier: string): string[] => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") out.push(p);
      }
    };
    walk(path.join(APP, dossier));
    return out.sort();
  };
  const params = { params: Promise.resolve({ id: "x", ligneId: "x", contratId: "x", type: "travail" }) };

  const cas: [dossier: string, etrangers: [string, () => Compte][]][] = [
    ["(app)", [
      ["EMPLOYE", () => compte("EMPLOYE", salarieId)],
      ["EMPLOYE+Stock", () => compte("EMPLOYE", salarieId, true)],
      ["STOCK", () => compte("STOCK", magasinierId)],
      ["COMPTA", () => compte("COMPTA", null)],
    ]],
    ["(stock)", [
      ["EMPLOYE sans accès Stock", () => compte("EMPLOYE", salarieId)],
      ["MANAGER", () => compte("MANAGER", null)],
      ["VIEWER", () => compte("VIEWER", null)],
      ["COMPTA", () => compte("COMPTA", null)],
    ]],
    ["(exploitation)", [
      ["EMPLOYE", () => compte("EMPLOYE", salarieId)],
      ["STOCK", () => compte("STOCK", magasinierId)],
      ["MANAGER", () => compte("MANAGER", null)],
    ]],
  ];

  for (const [dossier, etrangers] of cas) {
    it(`${dossier} : ${etrangers.map(([l]) => l).join(", ")}`, async () => {
      const fichiers = routesDe(dossier);
      expect(fichiers.length).toBeGreaterThan(0);
      for (const f of fichiers) {
        const mod = (await import(f)) as { GET: (req: Request, ctx: unknown) => Promise<Response> };
        for (const [libelle, qui] of etrangers) {
          A.user = qui();
          const r = await mod.GET(new Request("http://localhost/x?mois=7&annee=2026"), params);
          expect(r.status, `${path.relative(APP, f)} ouverte à ${libelle}`).toBe(403);
        }
      }
    }, 120_000);
  }
});
