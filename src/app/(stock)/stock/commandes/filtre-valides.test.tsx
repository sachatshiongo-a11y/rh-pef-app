// Le filtre d'état « Validés » des Bons de commande (plan d'ergonomie, V3) : il remplace la vue « Bons de commande validés »
// des Archives (`/stock/archives?vue=bons` renvoie vers `/stock/commandes?statut=VALIDE`). Éprouvé sur la VRAIE page,
// base simulée : la liste déroulante existe et porte l'état demandé, la requête ne lit QUE ces bons, une valeur
// inconnue n'écarte rien.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToReadableStream } from "react-dom/server";

const P = vi.hoisted(() => ({ bons: vi.fn<(a: unknown) => Promise<unknown[]>>(async () => []) }));
vi.mock("@/lib/garde-page", () => ({ exigerPageStock: async () => ({ id: "u", role: "STOCK" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bonDeCommande: { findMany: P.bons },
    ligneBonDeCommande: { groupBy: async () => [] },
    fournisseur: { findMany: async () => [] },
  },
}));
vi.mock("../_rapport/bouton-rapport", () => ({ BoutonRapport: () => null }));
vi.mock("./import-bc-btn", () => ({ ImportBonsCommandeBtn: () => null }));
vi.mock("./commandes-liste", () => ({ CommandesListe: () => null }));

beforeEach(() => P.bons.mockClear());

async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  const flux = await renderToReadableStream(await Page({ searchParams: Promise.resolve(sp) }));
  await flux.allReady;
  return await new Response(flux).text();
}
const whereDuListe = () => (P.bons.mock.calls[0][0] as { where: Record<string, unknown> }).where;

describe("Bons de commande — filtre d'état", () => {
  it("la liste déroulante « État » propose Tous les états puis les six états, « Validés » compris", async () => {
    const html = await rendre();
    const select = html.match(/<select name="statut"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
    expect([...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])).toEqual(["Tous les états", "Brouillons", "Validés", "Envoyés", "Reçus partiellement", "Reçus", "Annulés"]);
  });

  it("?statut=VALIDE : « Validés » est sélectionné et la requête ne lit que les bons validés", async () => {
    const html = await rendre({ statut: "VALIDE" });
    expect(html).toMatch(/<option value="VALIDE" selected="">Validés<\/option>/);
    expect(whereDuListe()).toMatchObject({ statut: "VALIDE" });
  });

  it("sans état, ou avec un état inconnu : aucun filtre d'état (tous les bons)", async () => {
    await rendre();
    expect(whereDuListe()).not.toHaveProperty("statut");
    P.bons.mockClear();
    await rendre({ statut: "N_IMPORTE_QUOI" });
    expect(whereDuListe()).not.toHaveProperty("statut");
  });

  it("le filtre se combine avec l'année, le mois et le fournisseur", async () => {
    await rendre({ statut: "BROUILLON", annee: "2026", mois: "10", fournisseurId: "f1" });
    expect(whereDuListe()).toEqual({ annee: 2026, mois: 10, fournisseurId: "f1", statut: "BROUILLON" });
  });
});
