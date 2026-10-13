import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// PROFONDEUR DES PAGES EN ALLERS-RETOURS SQL (13/10/2026). Sur Render (Francfort) → Supabase (Paris), chaque
// requête attendue APRÈS une autre ajoute un aller-retour au temps de la page. Ce test injecte une latence par
// requête au niveau du pilote `pg` et mesure la PROFONDEUR : le nombre d'allers-retours enchaînés (une requête
// partie après la fin d'une autre est un cran plus bas ; des requêtes lancées ensemble sont au même cran).
//
// Mesure du 13/10/2026 sur cette base — avant → après : Paie 18 → 9, Présences 10 → 8, Journal 6 → 3 (plafonds :
// l'après + 1, une machine très chargée pouvant décaler un départ). Et le détail hebdomadaire des Présences ne reçoit plus que des chiffres (identifiant +
// nom par salarié), plus les lignes complètes de la grille : il pesait ≈ 185 Ko de balises par ouverture.

const LATENCE_MS = 30;
type Req = { debut: number; fin: number; prof: number };
const H = vi.hoisted(() => ({
  client: undefined as unknown as PrismaClient,
  user: null as null | { id: string; email: string; nom: string; role: string; accesStock: boolean; employeeId: string | null },
  rendu: new Map<unknown, Map<string, unknown>>(),
  reqs: [] as { debut: number; fin: number; prof: number }[], actif: false,
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }) }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => H.user }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<object>()),
  redirect: (u: string) => { throw Object.assign(new Error(`REDIRECT ${u}`), { digest: `NEXT_REDIRECT;${u}` }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
vi.mock("react", async (orig) => {
  const R = await orig<typeof import("react")>();
  const cache = <F extends (...a: never[]) => unknown>(fn: F): F => ((...args: never[]) => {
    let m = H.rendu.get(fn); if (!m) H.rendu.set(fn, (m = new Map()));
    const k = JSON.stringify(args); if (!m.has(k)) m.set(k, fn(...args)); return m.get(k);
  }) as F;
  return { ...R, default: { ...R, cache }, cache };
});

// Pilote `pg` : latence injectée + profondeur de chaque requête (1 + la plus profonde déjà TERMINÉE à son départ).
const queryOrig = pg.Client.prototype.query;
(pg.Client.prototype as unknown as { query: unknown }).query = function (this: unknown, ...a: unknown[]) {
  if (!H.actif) return (queryOrig as (...x: unknown[]) => unknown).apply(this, a);
  const debut = performance.now();
  const prof = 1 + Math.max(0, ...H.reqs.filter((r) => r.fin <= debut).map((r) => r.prof));
  const req: Req = { debut, fin: Infinity, prof };
  H.reqs.push(req);
  const fin = () => { req.fin = performance.now(); };
  const cb = a[a.length - 1];
  if (typeof cb === "function") {
    a[a.length - 1] = (...r: unknown[]) => { fin(); return (cb as (...x: unknown[]) => unknown)(...r); };
    setTimeout(() => (queryOrig as (...x: unknown[]) => unknown).apply(this, a), LATENCE_MS);
    return undefined;
  }
  return new Promise((ok) => setTimeout(ok, LATENCE_MS)).then(() => (queryOrig as (...x: unknown[]) => Promise<unknown>).apply(this, a)).finally(fin);
};

/** Rendu serveur récursif : composants serveur appelés (async compris) ; un composant à hooks (client) est sauté. */
const elements: { type: unknown; props: Record<string, unknown> }[] = [];
async function resoudre(n: unknown, prof = 0): Promise<void> {
  if (prof > 200 || n == null || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const x of n) await resoudre(x, prof + 1); return; }
  if (typeof (n as Promise<unknown>).then === "function") return resoudre(await n, prof + 1);
  const el = n as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
  if (!el.$$typeof || !el.props) return;
  elements.push({ type: el.type, props: el.props });
  if (typeof el.type === "function") {
    let r: unknown;
    try { r = (el.type as (p: unknown) => unknown)(el.props); } catch (e) { if ((e as { digest?: string }).digest) throw e; for (const v of Object.values(el.props)) await resoudre(v, prof + 1); return; }
    return resoudre(await r, prof + 1);
  }
  for (const v of Object.values(el.props)) if (v && typeof v === "object") await resoudre(v, prof + 1);
}

const PAIE = (await import("./(app)/paie/page")).default;
const PRESENCES = (await import("./(app)/presences/page")).default;
const JOURNAL = (await import("./(exploitation)/exploitation/journal/page")).default;
const { WeeklyBreakdownTable } = await import("./(app)/heures-supp/weekly-breakdown-table");
const { reinitialiserCacheAValider } = await import("@/lib/a-valider-chargeurs");

let fermer: () => Promise<void>;
let adminId = "";
const auj = jourCivilKinshasa(new Date());
const moisCourant = auj.getUTCMonth() + 1, anneeCourante = auj.getUTCFullYear();

async function profondeur(page: (p: never) => Promise<unknown>, props: object): Promise<number> {
  H.user = { id: adminId, email: "dir@pef.test", nom: "Direction", role: "ADMIN", accesStock: false, employeeId: null };
  reinitialiserCacheAValider();
  H.rendu.clear(); H.reqs = []; elements.length = 0; H.actif = true;
  try { await resoudre(await page(props as never)); } finally { H.actif = false; }
  return Math.max(0, ...H.reqs.map((r) => r.prof));
}
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });

describe("profondeur SQL des pages les plus utilisées", () => {
  beforeAll(async () => {
    const base = await creerBaseTest();
    H.client = base.prisma; fermer = base.fermer;
    const p = base.prisma;
    await seedParametresLegaux(p, anneeCourante);
    await p.config.create({ data: { id: "singleton", tauxChangeCDF: 2850, moisCourant, anneeCourante, jourPaie: 28 } });
    adminId = (await p.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
    const run = await p.payrollRun.create({ data: { mois: moisCourant, annee: anneeCourante, tauxChangeUtilise: 2850 } });
    for (let i = 0; i < 8; i++) {
      const e = await p.employee.create({ data: { matricule: `N-${i}`, nom: `Salarié ${i}`, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: i < 6 ? "BRIGADE" : "BACKOFFICE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" } });
      await p.payrollLine.create({ data: { payrollRunId: run.id, employeeId: e.id, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 5, allocFamilialeUSD: 0, salNetUSD: 280, salNetCDF: 798000, cnssPatronalUSD: 20, coutEmployeurUSD: 330, coutEmployeurCDF: 940500 } });
      for (let j = 1; j <= Math.min(auj.getUTCDate(), 10); j++) {
        const date = new Date(Date.UTC(anneeCourante, moisCourant - 1, j));
        await p.attendance.create({ data: { employeeId: e.id, date, code: "P" } });
        await p.overtimeEntry.create({ data: { employeeId: e.id, date, heuresTravaillees: 8 } });
      }
    }
    // Exploitation : un petit plan comptable et des écritures du mois.
    const compte = await p.compteTresorerie.create({ data: { nom: "CASH", ordre: 1 } });
    const rRec = await p.rubrique.create({ data: { nom: "Recettes restaurant", sens: "RECETTE", ordre: 1 } });
    const rDep = await p.rubrique.create({ data: { nom: "Coûts Matières premières", sens: "DEPENSE", ordre: 2, ratioIdeal: 0.3, ratioMax: 0.35 } });
    const cRec = await p.categorie.create({ data: { nom: "Recettes paiement en espèces", rubriqueId: rRec.id } });
    const cDep = await p.categorie.create({ data: { nom: "Coûts aliments et boissons", rubriqueId: rDep.id, natureChargeDefaut: "CHARGES_VARIABLES" } });
    await p.ecritureCaisse.createMany({
      data: Array.from({ length: 40 }, (_, k) => ({
        date: new Date(Date.UTC(anneeCourante, moisCourant - 1, 1 + (k % Math.max(1, auj.getUTCDate())))), sens: k % 2 ? "RECETTE" as const : "DEPENSE" as const,
        rubriqueId: k % 2 ? rRec.id : rDep.id, categorieId: k % 2 ? cRec.id : cDep.id, denomination: `É ${k}`, compteId: compte.id,
        montantOrigine: 10 + k, devise: "USD" as const, tauxChangeUtilise: 2850, montantUSD: 10 + k,
      })),
    });
  }, 180_000);
  afterAll(async () => { await fermer?.(); });

  it("Paie : les lectures après le recalcul partent en étages parallèles", async () => {
    await profondeur(PAIE, sp()); // 1er affichage : la paie du mois se recalcule (écritures) — mesuré ensuite, sources inchangées
    const p = await profondeur(PAIE, sp());
    expect(p).toBeLessThanOrEqual(10);
  }, 60_000);

  it("Présences : paramètres de paie avec le rattrapage des congés, horaires avec le reste", async () => {
    const p = await profondeur(PRESENCES, sp());
    expect(p).toBeLessThanOrEqual(9);
  }, 60_000);

  it("Présences : le détail hebdomadaire (composant client) ne reçoit que l'identifiant et le nom des salariés", async () => {
    await profondeur(PRESENCES, sp());
    const hebdo = elements.filter((e) => e.type === WeeklyBreakdownTable);
    expect(hebdo).toHaveLength(1);
    const employes = hebdo[0].props.employees as Record<string, unknown>[];
    expect(employes.length).toBe(8);
    for (const e of employes) expect(Object.keys(e).sort()).toEqual(["id", "nom"]);
  }, 60_000);

  it("Journal : la liste des écritures est lue avec les chiffres de la période, pas après", async () => {
    const p = await profondeur(JOURNAL, sp({ mois: `${anneeCourante}-${String(moisCourant).padStart(2, "0")}` }));
    expect(p).toBeLessThanOrEqual(4);
  }, 60_000);
});
