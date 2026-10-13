// @vitest-environment happy-dom
//
// Inventaire : le fournisseur d'un article s'AFFICHE en lecture (ligne du tableau, carte du téléphone) comme
// un lien vers sa fiche ; il se CHOISIT en tapant son nom dans l'action groupée et à l'ajout — plus de liste
// déroulante à faire défiler. Une seule liste d'options pour tout le tableau.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { champChoix, choisirEnTapant, libellesOuverts, ouvrirChoix } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modifierArticle = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
const enMasse = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
const ajouterEnMasse = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
const retirerEnMasse = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: (...a: unknown[]) => modifierArticle(...a), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: (...a: unknown[]) => enMasse(...a), ajouterFournisseurEnMasse: (...a: unknown[]) => ajouterEnMasse(...a), retirerFournisseurEnMasse: (...a: unknown[]) => retirerEnMasse(...a), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

const base = { code: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", uniteParCarton: null, prix: "2", haussePct: null, quantite: "5", stockMinimum: "1", niveau: "OK" as const, unite: "Kg" };
const ARTICLES: ArticleRow[] = [
  { ...base, id: "a1", designation: "Riz", fournisseurId: "f1" },
  { ...base, id: "a2", designation: "Farine", fournisseurId: null },
];
const FOURNISSEURS = [{ id: "f1", nom: "Marché central" }, { id: "f2", nom: "Grossiste Nord" }, { id: "f3", nom: "Épicerie Kasa-Vubu" }];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  modifierArticle.mockClear();
  enMasse.mockClear(); ajouterEnMasse.mockClear(); retirerEnMasse.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }], fournisseurs: FOURNISSEURS })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

/** Cellule « Fournisseur » de la ligne du TABLEAU (ordinateur) d'un article. */
const celluleFournisseur = (designation: string) => {
  const ligne = [...conteneur.querySelectorAll("table tbody tr")].find((tr) => [...tr.querySelectorAll("a")].some((a) => a.textContent === designation))!;
  return ligne.querySelectorAll("td")[9];
};

describe("Inventaire — fournisseur en lecture, cliquable", () => {
  it("le tableau montre le nom du fournisseur en lien vers sa fiche ; « — » sans fournisseur", () => {
    const lien = celluleFournisseur("Riz").querySelector<HTMLAnchorElement>("a")!;
    expect(lien.textContent).toBe("Marché central");
    expect(lien.getAttribute("href")).toBe("/stock/fournisseurs/f1");
    expect(lien.className).toContain("text-primary");
    expect(lien.className).toContain("hover:underline");
    expect(celluleFournisseur("Farine").textContent).toBe("—");
    expect(celluleFournisseur("Farine").querySelector("a")).toBeNull();
  });

  it("la carte du téléphone dépliée montre le même lien vers la fiche fournisseur", () => {
    const carte = conteneur.querySelector<HTMLElement>('[data-article="a1"]')!;
    act(() => { carte.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(); });
    expect(carte.querySelector('a[href="/stock/fournisseurs/f1"]')!.textContent).toBe("Marché central");
  });

  it("aucune liste déroulante de fournisseurs ne subsiste dans les lignes, rien ne s'enregistre en ligne", () => {
    expect(conteneur.querySelectorAll("table tbody input:not([type=checkbox]), table tbody select")).toHaveLength(0);
    expect(conteneur.querySelectorAll('select option[value="f2"]')).toHaveLength(0);
    expect(modifierArticle).not.toHaveBeenCalled();
  });
});

describe("Inventaire — fournisseur choisi en tapant (action groupée)", () => {
  it("action groupée : on coche des articles, on tape le fournisseur, « Appliquer » envoie les ids et le fournisseur", async () => {
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('table tbody input[type="checkbox"]')];
    await act(async () => { cases[0].click(); cases[1].click(); });
    const champ = champChoix(conteneur, "Fournisseur de l'action groupée");
    expect(champ).toBeTruthy();
    await choisirEnTapant(champ, "nord");
    const appliquer = [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Définir habituel")!;
    expect(appliquer.disabled).toBe(false);
    await act(async () => appliquer.click());
    expect(enMasse).toHaveBeenCalledTimes(1);
    const [ids, four] = enMasse.mock.calls[0] as [string[], string];
    expect([...ids].sort()).toEqual(["a1", "a2"]);
    expect(four).toBe("f2");
  });

  it("une seule liste d'options : ouverte depuis l'action groupée, tous les fournisseurs", async () => {
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('table tbody input[type="checkbox"]')];
    await act(async () => { cases[0].click(); });
    await ouvrirChoix(champChoix(conteneur, "Fournisseur de l'action groupée"));
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(libellesOuverts()).toContain("Grossiste Nord");
    expect(libellesOuverts()).toHaveLength(4); // « — » + 3 fournisseurs
    expect(document.querySelector('[role="listbox"]')!.closest("table")).toBeNull(); // portail : le défilement du tableau ne la coupe pas
  });
});

describe("Inventaire — plusieurs fournisseurs par article (2026-10-16)", () => {
  it("la colonne Fournisseur montre l'habituel, avec « +2 » quand l'article a d'autres fournisseurs ; « sans habituel » sinon", () => {
    act(() => racine.render(h(CatalogueTable, {
      articles: [{ ...base, id: "a1", designation: "Riz", fournisseurId: "f1", nbFournisseurs: 3 }, { ...base, id: "a2", designation: "Farine", fournisseurId: null, nbFournisseurs: 2 }, { ...base, id: "a3", designation: "Sel", fournisseurId: "f1", nbFournisseurs: 1 }],
      categories: [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }], fournisseurs: FOURNISSEURS,
    })));
    const cell = (nom: string) => [...conteneur.querySelectorAll("table tbody tr")].find((tr) => [...tr.querySelectorAll("a")].some((a) => a.textContent === nom))!.querySelectorAll("td")[9];
    expect(cell("Riz").textContent).toBe("Marché central+2");
    expect(cell("Riz").querySelector("a")!.getAttribute("href")).toBe("/stock/fournisseurs/f1");
    expect(cell("Farine").textContent).toBe("2 fournisseurs, sans habituel");
    expect(cell("Sel").textContent).toBe("Marché central");
  });

  it("actions groupées : « Ajouter » et « Retirer » envoient les articles cochés et le fournisseur choisi", async () => {
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('table tbody input[type="checkbox"]')];
    await act(async () => { cases[0].click(); cases[1].click(); });
    await choisirEnTapant(champChoix(conteneur, "Fournisseur de l'action groupée"), "nord");
    const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent === t)!;
    await act(async () => bouton("Ajouter").click());
    expect(ajouterEnMasse).toHaveBeenCalledTimes(1);
    expect(ajouterEnMasse.mock.calls[0]).toEqual([expect.arrayContaining(["a1", "a2"]), "f2"]);
    await act(async () => { cases[0].click(); cases[1].click(); });
    await choisirEnTapant(champChoix(conteneur, "Fournisseur de l'action groupée"), "nord");
    await act(async () => bouton("Retirer").click());
    expect(retirerEnMasse).toHaveBeenCalledTimes(1);
    expect(retirerEnMasse.mock.calls[0]).toEqual([expect.arrayContaining(["a1", "a2"]), "f2"]);
  });
});
