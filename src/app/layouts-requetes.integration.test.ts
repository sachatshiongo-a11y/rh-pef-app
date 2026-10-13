import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { creerBaseTest } from "@/lib/test/db";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// COÛT DES LAYOUTS EN REQUÊTES (13/10/2026). Les trois coquilles (RH, Stock, Exploitation) tournent à chaque chargement
// complet et à chaque action serveur qui revalide ; sur l'offre gratuite de Render (0,1 vCPU), chaque requête Prisma
// coûte du temps de réponse. Ce test compte les allers-retours SQL RÉELS (au niveau du pilote `pg`) d'un rendu de
// chaque layout, sur une base éphémère, dans la fenêtre de clôture de paie (le cas le plus coûteux pour la Direction).
//
// Plafonds = mesure du 13/10/2026 APRÈS correction. Avant : RH Direction 30, Stock Direction 31, Exploitation Direction 30,
// magasinier 8. Gains : l'alerte de clôture n'est plus calculée là où elle n'est pas affichée (Stock, Exploitation : −8 dans
// la fenêtre de clôture) ; Config lue une fois par rendu (`config-rendu.ts` : −1 partout — Prisma fusionnait déjà les
// `findUnique` identiques d'un même tour, seule la lecture de forme différente de l'espace salarié était en double).

const H = vi.hoisted(() => ({
  client: undefined as unknown as PrismaClient,
  user: null as null | { id: string; email: string; nom: string; role: string; accesStock: boolean; employeeId: string | null },
  rendu: new Map<unknown, Map<string, unknown>>(),
  requetes: 0, actif: false,
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, k) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }) }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => H.user }));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<object>()), redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
// React.cache tel que Next l'applique : une mémoire par RENDU (vidée avant chaque layout mesuré).
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

const LAYOUT_RH = (await import("./(app)/layout")).default;
const LAYOUT_STOCK = (await import("./(stock)/layout")).default;
const LAYOUT_EXPLOITATION = (await import("./(exploitation)/layout")).default;
const { reinitialiserCacheAValider } = await import("@/lib/a-valider-chargeurs");

let fermer: () => Promise<void>;
const ids = { dir: "", stk: "" };

type Rendu = { props: { notif: { items: object[]; cloture: unknown } | null } };
async function rendre(layout: (p: { children: React.ReactNode }) => Promise<unknown>, qui: "dir" | "stk") {
  H.user = { id: ids[qui], email: `${qui}@pef.test`, nom: qui, role: qui === "dir" ? "ADMIN" : "STOCK", accesStock: false, employeeId: null };
  reinitialiserCacheAValider(); // chiffres RH lus à froid (cache de 20 s vide) : le cas d'une navigation après 20 s
  H.rendu.clear(); H.requetes = 0; H.actif = true;
  try { return { el: (await layout({ children: null })) as Rendu, requetes: H.requetes }; } finally { H.actif = false; }
}

describe("requêtes des layouts", () => {
  beforeAll(async () => {
    const base = await creerBaseTest();
    H.client = base.prisma; fermer = base.fermer;
    const p = base.prisma;
    // Fenêtre de clôture : mois courant = le mois de Kinshasa, paie dans 2 jours, des bulletins encore à valider.
    const auj = jourCivilKinshasa(new Date());
    await p.config.create({ data: { id: "singleton", tauxChangeCDF: 2850, moisCourant: auj.getUTCMonth() + 1, anneeCourante: auj.getUTCFullYear(), jourPaie: auj.getUTCDate() + 2 } });
    ids.dir = (await p.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
    ids.stk = (await p.user.create({ data: { email: "stk@pef.test", nom: "Magasin", role: "STOCK" } })).id;
    const run = await p.payrollRun.create({ data: { mois: auj.getUTCMonth() + 1, annee: auj.getUTCFullYear(), tauxChangeUtilise: 2850 } });
    for (let i = 0; i < 5; i++) {
      const e = await p.employee.create({ data: { matricule: `L-${i}`, nom: `Salarié ${i}`, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" } });
      await p.payrollLine.create({ data: { payrollRunId: run.id, employeeId: e.id, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 5, allocFamilialeUSD: 0, salNetUSD: 280, salNetCDF: 798000, cnssPatronalUSD: 20, coutEmployeurUSD: 330, coutEmployeurCDF: 940500 } });
    }
    await p.notification.createMany({ data: ["RH", "STOCK", "EXPLOITATION"].flatMap((domaine) => [0, 1, 2].map((k) => ({ domaine, type: "AUTRE", message: `${domaine} ${k}`, refId: `ref-${domaine}-${k}`, lu: k === 2 }))) });
  }, 120_000);
  afterAll(async () => { await fermer?.(); });

  it("coquille RH (Direction) : alerte de clôture calculée et affichée, Config lue une fois", async () => {
    const { el, requetes } = await rendre(LAYOUT_RH, "dir");
    expect(el.props.notif?.cloture).not.toBeNull();
    expect(requetes).toBeLessThanOrEqual(29);
  });

  it("coquilles Stock et Exploitation (Direction) : l'alerte de clôture, non affichée, n'est plus calculée", async () => {
    const stock = await rendre(LAYOUT_STOCK, "dir");
    const exploitation = await rendre(LAYOUT_EXPLOITATION, "dir");
    expect(stock.el.props.notif?.cloture).toBeNull();
    expect(exploitation.el.props.notif?.cloture).toBeNull();
    expect(stock.requetes).toBeLessThanOrEqual(23);
    expect(exploitation.requetes).toBeLessThanOrEqual(22);
  });

  it("coquille Stock (magasinier) : rien de la RH", async () => {
    const { requetes } = await rendre(LAYOUT_STOCK, "stk");
    expect(requetes).toBeLessThanOrEqual(8);
  });

  it("la cloche n'envoie au navigateur que ce qu'elle affiche", async () => {
    const { el } = await rendre(LAYOUT_STOCK, "dir");
    const items = el.props.notif!.items;
    expect(items.length).toBe(9);
    for (const n of items) expect(Object.keys(n).sort()).toEqual(["createdAt", "domaine", "id", "lien", "lu", "message", "type"]);
  });
});
