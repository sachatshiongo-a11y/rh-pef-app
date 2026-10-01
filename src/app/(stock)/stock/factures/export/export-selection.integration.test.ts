import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Export Excel des factures : tout (sans paramètre), ou la SÉLECTION de la barre d'actions groupées
// (`?ids=`). Une sélection mal formée ne se change jamais en export complet.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, feuilles: [] as { lignes: (string | number)[][] }[], garde: { ok: true } as { ok: boolean } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/garde-route", () => ({
  exigerEspaceStock: async () => (H.garde.ok ? { ok: true, user: {} } : { ok: false, reponse: new Response("Accès refusé.", { status: 403 }) }),
}));
vi.mock("@/lib/export-excel", () => ({
  classeurExcel: async (o: { feuilles: { lignes: (string | number)[][] }[] }) => { H.feuilles = o.feuilles; return Buffer.from("xlsx"); },
}));

let fermer: () => Promise<void>;
const ids: string[] = [];

async function exporter(query: string): Promise<string[]> {
  const { GET } = await import("./route");
  const r = await GET(new Request(`http://localhost/stock/factures/export${query}`));
  expect(r.status).toBe(200);
  return H.feuilles[0].lignes.map((l) => String(l[1])); // colonne « N° facture »
}

beforeAll(async () => {
  const db = await creerBaseTest();
  fermer = db.fermer; H.client = db.prisma;
  for (const n of ["A", "B", "C"]) {
    const f = await db.prisma.factureFournisseur.create({ data: { fournisseurNom: "SENEVE", numero: `F-${n}`, annee: 2026, mois: 9, montantUSD: 10, resteAPayerUSD: 10 } });
    ids.push(f.id);
  }
});
afterAll(async () => { await fermer(); });

describe("export des factures", () => {
  it("sans paramètre : toutes les factures (comportement d'origine)", async () => {
    expect((await exporter("")).sort()).toEqual(["F-A", "F-B", "F-C"]);
  });
  it("?ids= : seulement la sélection", async () => {
    expect((await exporter(`?ids=${ids[0]},${ids[2]}`)).sort()).toEqual(["F-A", "F-C"]);
  });
  it("?ids= sans identifiant valide : zéro ligne, jamais « tout »", async () => {
    expect(await exporter("?ids=")).toEqual([]);
    expect(await exporter("?ids=n-importe-quoi,1;DROP TABLE")).toEqual([]);
  });
  it("les identifiants invalides sont écartés, les valides gardés", async () => {
    expect(await exporter(`?ids=zzz,${ids[1]}`)).toEqual(["F-B"]);
  });
  it("plafond de 200 sélectionnées appliqué côté serveur : 400 lisible au-delà, rien n'est lu ; 200 passent", async () => {
    const { GET } = await import("./route");
    const lecture = vi.spyOn(H.client.factureFournisseur, "findMany");
    const faux = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
    const trop = await GET(new Request(`http://localhost/stock/factures/export?ids=${faux(201)}`));
    expect(trop.status).toBe(400);
    expect(trop.headers.get("Content-Type")).toContain("text/plain");
    expect(await trop.text()).toContain("200 factures au plus");
    expect(lecture).not.toHaveBeenCalled();
    const limite = await GET(new Request(`http://localhost/stock/factures/export?ids=${faux(200)}`));
    expect(limite.status).toBe(200);
    lecture.mockRestore();
  });
  it("hors de l'espace Stock : refusé, sans lecture", async () => {
    H.garde.ok = false;
    const { GET } = await import("./route");
    const r = await GET(new Request(`http://localhost/stock/factures/export?ids=${ids[0]}`));
    expect(r.status).toBe(403);
    H.garde.ok = true;
  });
});
