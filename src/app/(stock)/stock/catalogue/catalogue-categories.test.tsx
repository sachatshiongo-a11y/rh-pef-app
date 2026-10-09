// @vitest-environment happy-dom
//
// Inventaire × catégories (demande de la Direction, 2026-10-09) : un accès « Catégories » près de
// « + Ajouter un article » ; une catégorie ARCHIVÉE n'est plus proposée dans les listes de choix (ajout
// d'un article, action groupée « catégoriser », « changer le domaine »), mais ses articles restent
// visibles, groupés sous son nom.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(), changerDomaineEnMasse: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

const base = { code: null, nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const, fournisseurId: null, unite: "Kg", uniteParCarton: null, prix: "2", haussePct: null, quantite: "5", stockMinimum: "1", niveau: "OK" as const };
const ARTICLES: ArticleRow[] = [
  { ...base, id: "a1", designation: "Riz", categorieId: "active" },
  { ...base, id: "a2", designation: "Vieux stock", categorieId: "archivee" },
];
const CATEGORIES = [
  { id: "active", nom: "Épicerie", domaine: "NOURRITURE", actif: true },
  { id: "archivee", nom: "Anciennes denrées", domaine: "NOURRITURE", actif: false },
];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: CATEGORIES, fournisseurs: [] })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const optionsDe = (select: Element) => [...select.querySelectorAll("option")].map((o) => o.textContent);

describe("accès aux catégories", () => {
  it("un lien « Catégories » mène à l'écran de gestion, sur ordinateur comme dans le menu téléphone", () => {
    const liens = [...conteneur.querySelectorAll<HTMLAnchorElement>('a[href="/stock/catalogue/categories"]')];
    expect(liens.length).toBeGreaterThanOrEqual(1);
    expect(liens.every((a) => a.textContent === "Catégories")).toBe(true);
  });
});

describe("catégorie archivée", () => {
  it("n'est plus proposée à l'ajout d'un article", () => {
    clic([...conteneur.querySelectorAll("button")].find((b) => b.textContent === "+ Ajouter un article")!);
    const options = optionsDe(conteneur.querySelector('select[name="categorieId"]')!);
    expect(options.some((o) => o?.includes("Épicerie"))).toBe(true);
    expect(options.some((o) => o?.includes("Anciennes denrées"))).toBe(false);
  });

  it("ses articles restent visibles, groupés sous son nom", () => {
    expect(conteneur.textContent).toContain("Anciennes denrées (1)");
    expect(conteneur.textContent).toContain("Vieux stock");
  });
});
