import { describe, it, expect, vi, afterEach } from "vitest";
import pg from "pg";

// Journal de performance en production : ÉTEINT, il ne touche à rien ; ALLUMÉ, une ligne par requête avec
// un motif de route et des nombres — jamais un identifiant, un nom ou un paramètre.
const S = vi.hoisted(() => ({ store: undefined as undefined | { route: string; isStaticGeneration?: boolean }, apres: [] as (() => void)[] }));
vi.mock("next/server", () => ({ after: (f: () => void) => { S.apres.push(f); } }));
vi.mock("next/dist/server/app-render/work-async-storage.external", () => ({ workAsyncStorage: { getStore: () => S.store } }));

const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
const queryOriginale = proto.query;

async function charger(actif: boolean) {
  vi.resetModules();
  vi.stubEnv("JOURNAL_RENDU", actif ? "1" : "");
  // Pilote factice : la requête « répond » sans base.
  proto.query = function () { return Promise.resolve({ rows: [] }); };
  return import("./journal-rendu");
}

afterEach(() => {
  proto.query = queryOriginale;
  vi.unstubAllEnvs();
  S.store = undefined;
  S.apres = [];
});

describe("journal de rendu (JOURNAL_RENDU)", () => {
  it("éteint : aucune ligne, le pilote pg n'est pas modifié", async () => {
    const { noterRenduDePage, JOURNAL_RENDU_ACTIF } = await charger(false);
    const avant = proto.query;
    S.store = { route: "/paie" };
    noterRenduDePage();
    expect(JOURNAL_RENDU_ACTIF).toBe(false);
    expect(proto.query).toBe(avant);
    expect(S.apres).toEqual([]);
  });

  it("allumé : une ligne par requête, route en MOTIF, requêtes SQL comptées", async () => {
    const { noterRenduDePage } = await charger(true);
    S.store = { route: "/employes/[id]" };
    noterRenduDePage();
    noterRenduDePage(); // la même requête : toujours une seule ligne
    await (proto.query as (...a: unknown[]) => Promise<unknown>).call({}, "SELECT 1");
    await (proto.query as (...a: unknown[]) => Promise<unknown>).call({}, "SELECT 2");
    expect(S.apres).toHaveLength(1);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    S.apres[0]();
    const ligne = String(log.mock.calls[0]?.[0]);
    log.mockRestore();
    expect(ligne).toMatch(/^\[rendu\] route=\/employes\/\[id\] genre=page ms=\d+ sql=2 sql_fin_ms=\d+ cpu_ms=\d+$/);
  });

  it("allumé : une requête sans page (action, export) est notée « action/route » ; une autre requête a sa propre ligne", async () => {
    const { noterRenduDePage } = await charger(true);
    S.store = { route: "/paie" };
    noterRenduDePage(); // installe le compteur
    S.store = { route: "/stock/catalogue/export" };
    await (proto.query as (...a: unknown[]) => Promise<unknown>).call({}, "SELECT 1");
    expect(S.apres).toHaveLength(2);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    S.apres[1]();
    expect(String(log.mock.calls[0]?.[0])).toMatch(/route=\/stock\/catalogue\/export genre=action\/route .* sql=1 /);
    log.mockRestore();
  });

  it("un rejet SQL reste un rejet pour Prisma (le compteur ne l'avale pas)", async () => {
    const { noterRenduDePage } = await charger(true);
    proto.query = function () { return Promise.reject(new Error("panne")); };
    S.store = { route: "/paie" };
    noterRenduDePage();
    await expect((proto.query as (...a: unknown[]) => Promise<unknown>).call({}, "SELECT 1")).rejects.toThrow("panne");
  });

  it("une route qui porterait autre chose qu'un motif n'est jamais écrite telle quelle", async () => {
    const { noterRenduDePage } = await charger(true);
    S.store = { route: "/employes/Jean Dupont?x=1" };
    noterRenduDePage();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    S.apres[0]();
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^\[rendu\] route=\? /);
    log.mockRestore();
  });

  it("rendu statique au build : rien", async () => {
    const { noterRenduDePage } = await charger(true);
    S.store = { route: "/hors-ligne", isStaticGeneration: true };
    noterRenduDePage();
    expect(S.apres).toEqual([]);
  });
});
