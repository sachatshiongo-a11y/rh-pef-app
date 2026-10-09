// @vitest-environment happy-dom
//
// Inventaire (2026-10-09) : « Changer le domaine (n) » dans les actions groupées (catégorie : même nom,
// « à classer » ou une catégorie du NOUVEAU domaine), et l'anti-doublon de « Ajouter un article »
// (« Utiliser … » ouvre la fiche de l'article existant ; « Créer quand même » renvoie la saisie).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = vi.hoisted(() => ({
  creerArticle: vi.fn(async (_fd: FormData): Promise<unknown> => undefined),
  changerDomaineEnMasse: vi.fn(async (_ids: string[], _d: string, _c?: string): Promise<unknown> => ({ proposition: false, message: "2 article(s) passé(s) en Boissons. Ni stock ni mouvement n'a changé." })),
}));
vi.mock("./actions", () => ({
  creerArticle: A.creerArticle, changerDomaineEnMasse: A.changerDomaineEnMasse, modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(), corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];
const base = { code: null, nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", fournisseurId: null, uniteParCarton: null, prix: "2", haussePct: null, unite: "Kg", stockMinimum: "0", niveau: "OK" as const };
const ARTICLES: ArticleRow[] = [{ ...base, id: "jus", designation: "Jus d'orange", quantite: "3" }, { ...base, id: "steak", designation: "Steak", quantite: "1" }];
const CATS = [{ id: "c1", nom: "Jus", domaine: "NOURRITURE" }, { id: "c2", nom: "Jus", domaine: "BOISSON" }, { id: "c3", nom: "Sodas", domaine: "BOISSON" }];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  A.creerArticle.mockClear(); A.changerDomaineEnMasse.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: CATS, fournisseurs: [] })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
const choisir = (sel: HTMLSelectElement, v: string) => act(() => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); });

describe("Inventaire — changer le domaine en lot", () => {
  it("cocher, choisir Boissons : seules les catégories des Boissons sont proposées ; le compte rendu s'affiche", async () => {
    act(() => (conteneur.querySelector<HTMLInputElement>('input[aria-label="Tout sélectionner"], thead input[type="checkbox"]') ?? conteneur.querySelector<HTMLInputElement>('input[type="checkbox"]')!).click());
    const dom = conteneur.querySelector<HTMLSelectElement>('select[aria-label="Nouveau domaine des articles sélectionnés"]')!;
    expect(bouton("Changer le domaine").disabled).toBe(true);
    choisir(dom, "BOISSON");
    const cat = conteneur.querySelector<HTMLSelectElement>('select[aria-label="Catégorie dans le nouveau domaine"]')!;
    expect([...cat.options].map((o) => o.textContent)).toEqual(["Catégorie du même nom, sinon « à classer »", "« À classer » pour tous", "Jus", "Sodas"]);
    choisir(cat, "c3");
    await act(async () => bouton("Changer le domaine").click());
    expect(A.changerDomaineEnMasse).toHaveBeenCalledTimes(1);
    expect(A.changerDomaineEnMasse.mock.calls[0]!.slice(1)).toEqual(["BOISSON", "c3"]);
    await vi.waitFor(() => expect(conteneur.querySelector("[data-compte-rendu]")?.textContent).toContain("passé(s) en Boissons"));
  });
});

describe("Inventaire — anti-doublon de « Ajouter un article »", () => {
  it("nom proche : choix montré, « Utiliser » mène à la fiche, « Créer quand même » renvoie la saisie avec creerQuandMeme", async () => {
    A.creerArticle.mockResolvedValueOnce({ doublon: true, creationPossible: true, message: "…", candidats: [{ id: "tomates", designation: "Tomates", unite: "kg", domaine: "NOURRITURE", prix: null, actif: true }] });
    act(() => bouton("+ Ajouter un article").click());
    const form = [...conteneur.querySelectorAll("form")].find((f) => f.querySelector('input[name="designation"]'))!;
    act(() => { (form.querySelector('input[name="designation"]') as HTMLInputElement).value = "Tomate"; });
    await act(async () => { form.requestSubmit(); });
    await vi.waitFor(() => expect(conteneur.querySelector("[data-choix-article]")).not.toBeNull());
    expect(conteneur.querySelector('[data-utiliser="tomates"]')?.getAttribute("href")).toBe("/stock/catalogue/tomates");
    await act(async () => (conteneur.querySelector("[data-creer]") as HTMLButtonElement).click());
    await vi.waitFor(() => expect(A.creerArticle).toHaveBeenCalledTimes(2));
    const fd = A.creerArticle.mock.calls[1]![0];
    expect([fd.get("designation"), fd.get("creerQuandMeme")]).toEqual(["Tomate", "1"]);
  });

  it("nom exact : pas de « Créer quand même »", async () => {
    A.creerArticle.mockResolvedValueOnce({ doublon: true, creationPossible: false, message: "…", candidats: [{ id: "coca", designation: "Coca-Cola 33cl", unite: null, domaine: "BOISSON", prix: null, actif: false }] });
    act(() => bouton("+ Ajouter un article").click());
    const form = [...conteneur.querySelectorAll("form")].find((f) => f.querySelector('input[name="designation"]'))!;
    act(() => { (form.querySelector('input[name="designation"]') as HTMLInputElement).value = "coca cola 330 ml"; });
    await act(async () => { form.requestSubmit(); });
    await vi.waitFor(() => expect(conteneur.querySelector("[data-choix-article]")?.textContent).toContain("existe déjà au catalogue"));
    expect(conteneur.querySelector("[data-creer]")).toBeNull();
    expect(conteneur.querySelector('[data-utiliser="coca"]')?.textContent).toContain("(inactif)");
  });
});
