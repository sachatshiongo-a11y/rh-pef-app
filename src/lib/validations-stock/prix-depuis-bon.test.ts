import { describe, it, expect, vi, beforeEach } from "vitest";

// Prix du catalogue mis à jour depuis un bon de commande (2026-11-12) : lignes retenues, article réellement changé,
// Direction = écriture directe journalisée, autre compte = proposition, refus rapporté sans défaire le bon.
const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  transaction: vi.fn(),
  journaliser: vi.fn(async () => undefined),
  proposer: vi.fn(),
  appliquer: vi.fn(async () => undefined),
  lire: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { articleStock: { findMany: m.findMany }, $transaction: m.transaction } }));
vi.mock("@/lib/audit", () => ({ journaliser: m.journaliser }));
vi.mock("./demandes", () => ({ estDirection: (u: { role: string }) => u.role === "ADMIN", proposerModifications: m.proposer }));
vi.mock("./article", () => ({
  appliquerPatchArticleTx: m.appliquer,
  lireArticlesTx: m.lire,
  nomsReferencesTx: vi.fn(async () => ({ categories: new Map(), fournisseurs: new Map() })),
  changementsDe: vi.fn((_e: unknown, patch: Record<string, unknown>) => Object.keys(patch).map((champ) => ({ champ }))),
  texteChangements: (c: { champ: string }[]) => c.map((x) => x.champ).join(","),
}));
import { majPrixCatalogueDepuisBon, patchPrix, prixATransmettre } from "./prix-depuis-bon";

const dec = (s: string) => ({ toString: () => s });
const direction = { id: "u1", nom: "Sacha", role: "ADMIN" as const };
const magasinier = { id: "u2", nom: "Aline", role: "STOCK" as never };
const bon = { id: "b1", numero: "001/PEF/NOV/26" };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockClear());
  m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  m.lire.mockResolvedValue(new Map([["a1", {}]]));
});

describe("prixATransmettre : quelles lignes touchent le catalogue", () => {
  it("seulement les lignes reliées à un article, touchées, avec un prix > 0", () => {
    expect(prixATransmettre([
      { articleId: "a1", prix: 3, prixTouche: true },
      { articleId: "a2", prix: 5, prixTouche: false }, // prix seulement proposé
      { articleId: null, prix: 9, prixTouche: true }, // ligne libre
      { articleId: "a3", prix: null, prixTouche: true }, // sans prix : jamais de remise à zéro
      { articleId: "a4", prix: 0, prixTouche: true },
      { articleId: "a5", prix: 0.00001, prixTouche: true }, // arrondi à 0 en dollars (4 décimales)
    ], "USD")).toEqual([{ articleId: "a1", prix: "3" }]);
  });
  it("la dernière ligne touchée d'un même article gagne ; précision 4 décimales en dollars, 2 en francs", () => {
    expect(prixATransmettre([{ articleId: "a1", prix: 1, prixTouche: true }, { articleId: "a1", prix: 1.23456, prixTouche: true }], "USD")).toEqual([{ articleId: "a1", prix: "1.2346" }]);
    expect(prixATransmettre([{ articleId: "a1", prix: 7000.456, prixTouche: true }], "CDF")).toEqual([{ articleId: "a1", prix: "7000.46" }]);
  });
});

describe("patchPrix : le catalogue a-t-il vraiment changé ?", () => {
  const usd = { devisePrix: "USD" as const, prixUnitaireUSD: dec("2.5"), prixUnitaireCDF: null };
  it("même devise, même prix (écriture différente) : rien", () => {
    expect(patchPrix(usd, "USD", "2.5000")).toBeNull();
  });
  it("même devise, autre prix : le seul prix change", () => {
    expect(patchPrix(usd, "USD", "3")).toEqual({ prixUnitaireUSD: "3" });
  });
  it("autre devise (bon en francs, article en dollars) : la devise de saisie fait foi, la devise suit", () => {
    expect(patchPrix(usd, "CDF", "7000")).toEqual({ devisePrix: "CDF", prixUnitaireCDF: "7000" });
  });
  it("article sans prix : le prix est posé", () => {
    expect(patchPrix({ devisePrix: "USD", prixUnitaireUSD: null, prixUnitaireCDF: null }, "USD", "1")).toEqual({ prixUnitaireUSD: "1" });
  });
});

describe("majPrixCatalogueDepuisBon", () => {
  const article = { id: "a1", designation: "Farine", devisePrix: "USD", prixUnitaireUSD: dec("2.5"), prixUnitaireCDF: null };

  it("Direction : écrit tout de suite par la porte d'écriture des articles et journalise avant → après", async () => {
    m.findMany.mockResolvedValue([article]);
    const r = await majPrixCatalogueDepuisBon(direction, bon, "USD", [{ articleId: "a1", prix: 3, prixTouche: true }]);
    expect(m.appliquer).toHaveBeenCalledWith(expect.anything(), "a1", { prixUnitaireUSD: "3" });
    expect(m.proposer).not.toHaveBeenCalled();
    expect(m.journaliser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entite: "ArticleStock", entiteId: "a1", userId: "u1", nouvelleValeur: expect.stringContaining("001/PEF/NOV/26") }));
    expect(r).toMatchObject({ appliques: 1, proposes: 0 });
    expect(r.message).toContain("mis à jour");
  });

  it("autre compte : PROPOSITION à valider, le catalogue n'est pas écrit", async () => {
    m.findMany.mockResolvedValue([article]);
    m.proposer.mockResolvedValue({ rien: false, demandeId: "d1", nbArticles: 1, fusionnee: false });
    const r = await majPrixCatalogueDepuisBon(magasinier, bon, "USD", [{ articleId: "a1", prix: 3, prixTouche: true }]);
    expect(m.proposer).toHaveBeenCalledWith(magasinier, expect.stringContaining("001/PEF/NOV/26"), [{ id: "a1", patch: { prixUnitaireUSD: "3" } }]);
    expect(m.appliquer).not.toHaveBeenCalled();
    expect(r).toMatchObject({ appliques: 0, proposes: 1 });
    expect(r.message).toContain("Direction");
  });

  it("prix identique au catalogue, prix non touché, ligne sans prix : aucune écriture, aucune requête", async () => {
    m.findMany.mockResolvedValue([article]);
    expect(await majPrixCatalogueDepuisBon(direction, bon, "USD", [{ articleId: "a1", prix: 2.5, prixTouche: true }])).toEqual({ appliques: 0, proposes: 0, message: null });
    expect(await majPrixCatalogueDepuisBon(direction, bon, "USD", [{ articleId: "a1", prix: 9, prixTouche: false }, { articleId: "a1", prix: null, prixTouche: true }])).toEqual({ appliques: 0, proposes: 0, message: null });
    expect(m.appliquer).not.toHaveBeenCalled();
    expect(m.proposer).not.toHaveBeenCalled();
  });

  it("proposition déjà en attente d'un autre compte : le refus est rapporté, sans lever (le bon reste enregistré)", async () => {
    m.findMany.mockResolvedValue([article]);
    m.proposer.mockRejectedValue(new Error("« Farine » a déjà une proposition en attente"));
    const r = await majPrixCatalogueDepuisBon(magasinier, bon, "USD", [{ articleId: "a1", prix: 3, prixTouche: true }]);
    expect(r.proposes).toBe(0);
    expect(r.message).toMatch(/Le bon est enregistré.*Farine/);
  });
});
