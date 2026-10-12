// L'onglet « Comptages passés » de Réconciliation (plan d'ergonomie, V3) : l'historique des comptages, qui vivait dans
// Archives. Éprouvé sur la VRAIE page, base simulée : onglets (le bon est actif), liste des comptages (chaque ligne mène à
// la fiche /stock/archives/<id>, adresse conservée), état vide, et le fait que cette vue n'ouvre ni articles ni demandes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToReadableStream } from "react-dom/server";

const P = vi.hoisted(() => ({
  sessions: [] as { id: string; date: Date; domaine: string | null; nbArticles: number; nbEcarts: number; nbHorsTol: number }[],
  articles: vi.fn(async () => []),
}));
vi.mock("@/lib/garde-page", () => ({ exigerPageStock: async () => ({ id: "u", role: "STOCK" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sessionComptage: { count: async () => P.sessions.length, findMany: async () => P.sessions },
    articleStock: { findMany: P.articles },
    demandeValidationStock: { findMany: async () => [] },
  },
}));
vi.mock("./reconciliation-client", () => ({ ReconciliationForm: () => null }));
vi.mock("./fiches-vierges", () => ({ FichesVierges: () => null }));
vi.mock("../imports/import-client", () => ({ ImportInventaireClient: () => null }));

beforeEach(() => { P.sessions = []; P.articles.mockClear(); });

async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  const flux = await renderToReadableStream(await Page({ searchParams: Promise.resolve(sp) }));
  await flux.allReady;
  return await new Response(flux).text();
}
/** Les onglets de vue : libellé → actif ou non (aria-current). */
const onglets = (html: string) => {
  const nav = html.match(/<nav aria-label="Vues de la réconciliation"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  return [...nav.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ label: m[2], href: /href="([^"]*)"/.exec(m[1])?.[1], actif: /aria-current="page"/.test(m[1]) }));
};

describe("Réconciliation > Comptages passés", () => {
  it("?vue=comptages : deux onglets, « Comptages passés » actif, lien vers « Comptage »", async () => {
    const o = onglets(await rendre({ vue: "comptages" }));
    expect(o.map((x) => x.label)).toEqual(["Comptage", "Comptages passés"]);
    expect(o.find((x) => x.actif)?.label).toBe("Comptages passés");
    expect(o[0].href).toBe("/stock/reconciliation");
  });

  it("sans vue : l'onglet « Comptage » est actif (la saisie reste l'écran d'arrivée)", async () => {
    const o = onglets(await rendre());
    expect(o.find((x) => x.actif)?.label).toBe("Comptage");
    expect(o[1].href).toBe("/stock/reconciliation?vue=comptages");
  });

  it("liste chaque comptage avec son lien vers la fiche /stock/archives/<id>, ses écarts et ses hors tolérance", async () => {
    P.sessions = [
      { id: "c2", date: new Date("2026-10-05T00:00:00Z"), domaine: "BOISSON", nbArticles: 40, nbEcarts: 3, nbHorsTol: 2 },
      { id: "c1", date: new Date("2026-09-28T00:00:00Z"), domaine: null, nbArticles: 80, nbEcarts: 0, nbHorsTol: 0 },
    ];
    const html = await rendre({ vue: "comptages" });
    expect(html).toContain('href="/stock/archives/c2"');
    expect(html).toContain('href="/stock/archives/c1"');
    const texte = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(texte).toContain("Boissons · 40 articles · 3 écart(s)");
    expect(texte).toContain("2 hors tol.");
    expect(texte).toContain("Tous · 80 articles · 0 écart(s)");
  });

  it("sans comptage : un état vide, pas un tableau vide", async () => {
    expect(await rendre({ vue: "comptages" })).toContain("Aucun comptage archivé.");
  });

  it("cette vue n'ouvre ni les articles ni le formulaire de comptage", async () => {
    await rendre({ vue: "comptages" });
    expect(P.articles).not.toHaveBeenCalled();
    await rendre();
    expect(P.articles).toHaveBeenCalledTimes(1);
  });
});
