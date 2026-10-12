// « Clôture du mois » du Stock (plan d'ergonomie, V8) : la page qui a quitté Paramètres. Mêmes droits qu'avant :
// la Direction seule (la page Paramètres était réservée à l'ADMIN) ; la garde Stock est la 1re instruction.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const G = vi.hoisted(() => ({ garde: vi.fn(async () => ({ id: "u", role: "ADMIN" })) }));
vi.mock("@/lib/garde-page", () => ({ exigerPageStock: G.garde }));
vi.mock("@/components/stock/cloture-stock-section", () => ({ ClotureStockSection: () => <p>LISTE DES MOIS</p> }));

beforeEach(() => G.garde.mockClear());

const rendre = async (sp: { erreur?: string } = {}) => {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
};

describe("/stock/cloture", () => {
  it("la Direction voit le titre « Clôture du mois » et la liste des mois", async () => {
    const html = await rendre();
    expect(html).toContain("<h1");
    expect(html).toContain("Clôture du mois</h1>");
    expect(html).toContain("LISTE DES MOIS");
    expect(G.garde).toHaveBeenCalledTimes(1);
  });

  it("le refus d'une action revient par ?erreur= et s'affiche", async () => {
    expect(await rendre({ erreur: "Septembre 2026 est déjà clôturé" })).toContain("Septembre 2026 est déjà clôturé");
  });

  it.each(["STOCK", "MANAGER", "VIEWER", "COMPTA"])("%s : page introuvable (Direction uniquement, comme avant dans Paramètres)", async (role) => {
    G.garde.mockResolvedValueOnce({ id: "u", role });
    await expect(rendre()).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_(HTTP_ERROR_FALLBACK;404|NOT_FOUND)/) });
  });

  it("un compte hors Stock est renvoyé par la garde, avant toute lecture", async () => {
    G.garde.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/entree;307;" }));
    await expect(rendre()).rejects.toMatchObject({ digest: expect.stringContaining("/entree") });
  });
});

// La clôture a quitté Paramètres (lot 8, V8) : ni rubrique au sommaire, ni section dans la page, ni composant importé.
describe("Paramètres ne porte plus la clôture du stock", () => {
  const parametres = readFileSync(path.join(__dirname, "../../../(app)/parametres/page.tsx"), "utf8");
  it("ni entrée de sommaire, ni section, ni import du composant", () => {
    expect(parametres).not.toContain("cloture-stock");
    expect(parametres).not.toContain("ClotureStockSection");
    expect(parametres).not.toMatch(/Clôture (mensuelle )?du stock/);
  });
  it("les textes d'erreur du Stock renvoient à « Stock → Clôture du mois », plus à Paramètres", () => {
    const lib = readFileSync(path.join(__dirname, "../../../../lib/cloture-stock.ts"), "utf8");
    expect(lib).toContain("Stock → Clôture du mois");
    expect(lib).not.toContain("Paramètres → Clôture");
  });
});
