import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// COÛT DE LA FICHE SALARIÉ EN REQUÊTES, ONGLET PAR ONGLET (13/10/2026). Sur Render gratuit (0,1 vCPU, Francfort →
// Supabase Paris ≈ 10 ms l'aller-retour, 10 connexions au plus), chaque requête compte. Ce test compte les allers-retours
// SQL RÉELS (au niveau du pilote `pg`, BEGIN/COMMIT compris) d'un rendu de la page, sur une base éphémère.
//
// Plafonds = mesure du 13/10/2026 APRÈS correction, sur ce jeu. Avant (même jeu, fiche active) : Aperçu 82, Temps 63,
// Congés 69, Paie 59, Contrats 71, Dossier 59 — chaque onglet lisait tout, et la fiche, sa Config, ses fins de contrat, les
// paramètres de paie étaient relus par chaque fonction appelée. Un dépassement = une lecture ajoutée au tronc commun ou à
// un onglet qui ne l'affiche pas, ou une relecture : la passer à la fonction (voir le paragraphe en tête du chargement
// de `page.tsx`) plutôt que relever le plafond.

const H = vi.hoisted(() => ({
  client: undefined as unknown as PrismaClient,
  user: null as null | { id: string; email: string; nom: string; role: string; accesStock: boolean; employeeId: string | null },
  rendu: new Map<unknown, Map<string, unknown>>(),
  requetes: 0, actif: false,
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }) }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => H.user }));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<object>()), redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
// React.cache tel que Next l'applique : une mémoire par RENDU (vidée avant chaque rendu mesuré).
vi.mock("react", async (orig) => {
  const R = await orig<typeof import("react")>();
  const cache = <F extends (...a: never[]) => unknown>(fn: F): F => ((...args: never[]) => {
    let m = H.rendu.get(fn); if (!m) H.rendu.set(fn, (m = new Map()));
    const k = JSON.stringify(args); if (!m.has(k)) m.set(k, fn(...args)); return m.get(k);
  }) as F;
  return { ...R, default: { ...R, cache }, cache };
});

const queryOrig = pg.Client.prototype.query;
(pg.Client.prototype as unknown as { query: unknown }).query = function (this: unknown, ...a: unknown[]) {
  if (H.actif) H.requetes++;
  return (queryOrig as (...x: unknown[]) => unknown).apply(this, a);
};

const PAGE = (await import("./page")).default as (p: unknown) => Promise<unknown>;

let fermer: () => Promise<void>;
const ids = { dir: "", actif: "", parti: "" };

async function compter(employeeId: string, tab: string) {
  H.user = { id: ids.dir, email: "dir@pef.test", nom: "Direction", role: "ADMIN", accesStock: false, employeeId: null };
  H.rendu.clear(); H.requetes = 0; H.actif = true;
  try {
    const el = await PAGE({ params: Promise.resolve({ id: employeeId }), searchParams: Promise.resolve({ tab }) });
    expect(el).toBeTruthy();
    return H.requetes;
  } finally { H.actif = false; }
}

describe("requêtes de la fiche salarié, par onglet", () => {
  beforeAll(async () => {
    const base = await creerBaseTest();
    H.client = base.prisma; fermer = base.fermer;
    const p = base.prisma;
    const auj = jourCivilKinshasa(new Date());
    const mois = auj.getUTCMonth() + 1, annee = auj.getUTCFullYear();
    const prec = mois === 1 ? { mois: 12, annee: annee - 1 } : { mois: mois - 1, annee };
    await p.config.create({ data: { id: "singleton", tauxChangeCDF: 2850, moisCourant: mois, anneeCourante: annee, jourPaie: 28 } });
    await seedParametresLegaux(p, annee);
    ids.dir = (await p.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
    const fiche = { sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: new Date("2024-01-15"), contrat: "CDI" };
    ids.actif = (await p.employee.create({ data: { ...fiche, matricule: "F-1", nom: "Salariée Active" } })).id;
    ids.parti = (await p.employee.create({ data: { ...fiche, matricule: "F-2", nom: "Salarié Parti", actif: false } })).id;
    for (const e of [ids.actif, ids.parti]) {
      await p.contrat.create({ data: { employeeId: e, type: "CDI", dateDebut: new Date("2024-01-15"), salaireMensuel: 300, poste: "Commis" } });
      await p.leaveRequest.create({ data: { employeeId: e, type: "Congé annuel", dateDebut: new Date("2025-08-04"), dateFin: new Date("2025-08-09"), nbJours: 6, statut: "APPROUVE" } });
      await p.attendance.createMany({ data: [1, 2, 3].map((j) => ({ employeeId: e, date: new Date(Date.UTC(annee, mois - 1, j)), code: "P" as const })) });
    }
    await p.finContrat.create({ data: { employeeId: ids.parti, motif: "DEMISSION", dateFin: new Date(Date.UTC(prec.annee, prec.mois - 1, 15)), salaireJournalierUSD: 10 } });
    const ligne = { salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 5, allocFamilialeUSD: 0, salNetUSD: 280, salNetCDF: 798000, cnssPatronalUSD: 20, coutEmployeurUSD: 330, coutEmployeurCDF: 940500 };
    const runPrec = await p.payrollRun.create({ data: { ...prec, statut: "VALIDE", tauxChangeUtilise: 2850 } });
    const run = await p.payrollRun.create({ data: { mois, annee, tauxChangeUtilise: 2850 } });
    for (const e of [ids.actif, ids.parti]) {
      await p.payrollLine.create({ data: { ...ligne, payrollRunId: runPrec.id, employeeId: e, statutPaiement: "PAYE" } });
      await p.payrollLine.create({ data: { ...ligne, payrollRunId: run.id, employeeId: e } });
    }
  }, 120_000);
  afterAll(async () => { await fermer?.(); });

  // Fiche active : chaque onglet. Le tronc commun (bandeaux, en-tête, solde de congés, notifications) est inclus.
  const PLAFONDS_ACTIVE: Record<string, number> = { apercu: 43, temps: 19, conges: 16, paie: 31, contrats: 32, dossier: 21 };
  for (const [tab, plafond] of Object.entries(PLAFONDS_ACTIVE)) {
    it(`fiche active, onglet ${tab} : au plus ${plafond} requêtes`, async () => {
      expect(await compter(ids.actif, tab)).toBeLessThanOrEqual(plafond);
    });
  }

  // Fiche désactivée, sortie par fin de contrat : la date de sortie vient de la fiche et des fins de contrat déjà lues
  // (avant : 2 lectures de plus) ; pas de solde de tout compte à proposer sur l'onglet Contrats (6 lectures de moins).
  it("fiche désactivée : Temps au plus 19 requêtes, Contrats au plus 26", async () => {
    expect(await compter(ids.parti, "temps")).toBeLessThanOrEqual(19);
    expect(await compter(ids.parti, "contrats")).toBeLessThanOrEqual(26);
  });
});
