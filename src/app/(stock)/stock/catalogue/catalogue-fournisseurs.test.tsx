// @vitest-environment happy-dom
//
// Inventaire : le fournisseur d'un article se choisit en TAPANT son nom (ligne du tableau, carte du
// téléphone, action groupée, ajout) — plus de liste déroulante à faire défiler. Même enregistrement
// qu'avant (`modifierArticle` avec fournisseurId), une seule liste d'options pour tout le tableau.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { champChoix, choisirEnTapant, libellesOuverts, ouvrirChoix, taperChoix, valeurChoisie } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modifierArticle = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
const enMasse = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: (...a: unknown[]) => modifierArticle(...a), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: (...a: unknown[]) => enMasse(...a), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

const base = { code: null, nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", uniteParCarton: null, prix: "2", haussePct: null, quantite: "5", stockMinimum: "1", niveau: "OK" as const, unite: "Kg" };
const ARTICLES: ArticleRow[] = [
  { ...base, id: "a1", designation: "Riz", fournisseurId: "f1" },
  { ...base, id: "a2", designation: "Farine", fournisseurId: null },
];
const FOURNISSEURS = [{ id: "f1", nom: "Marché central" }, { id: "f2", nom: "Grossiste Nord" }, { id: "f3", nom: "Épicerie Kasa-Vubu" }];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  modifierArticle.mockClear();
  enMasse.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }], fournisseurs: FOURNISSEURS })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

/** Champ fournisseur de la ligne du TABLEAU (ordinateur) d'un article. */
const champLigne = (designation: string) =>
  [...conteneur.querySelectorAll<HTMLInputElement>(`table input[role="combobox"][aria-label="Fournisseur — ${designation}"]`)][0]!;

describe("Inventaire — fournisseur choisi en tapant", () => {
  it("la ligne affiche le fournisseur de l'article ; aucune liste déroulante de fournisseurs ne subsiste", () => {
    expect(champLigne("Riz").value).toBe("Marché central");
    expect(champLigne("Farine").value).toBe("");
    expect(conteneur.querySelectorAll('select option[value="f2"]')).toHaveLength(0);
  });

  it("taper « kasa » puis Entrée enregistre le fournisseur de la ligne (même appel qu'avant)", async () => {
    await choisirEnTapant(champLigne("Farine"), "kasa");
    await vi.waitFor(() => expect(modifierArticle).toHaveBeenCalledTimes(1));
    const [id, fd] = modifierArticle.mock.calls[0] as [string, FormData];
    expect(id).toBe("a2");
    expect(fd.get("fournisseurId")).toBe("f3");
    expect([...fd.keys()]).toEqual(["fournisseurId"]);
  });

  it("taper puis quitter sans choisir n'enregistre rien ; choisir le fournisseur déjà en place non plus", async () => {
    await taperChoix(champLigne("Riz"), "nord");
    await act(async () => champLigne("Riz").blur());
    expect(champLigne("Riz").value).toBe("Marché central");
    await choisirEnTapant(champLigne("Riz"), "marche");
    expect(modifierArticle).not.toHaveBeenCalled();
  });

  it("« — » vide le fournisseur (valeur vide envoyée, comme l'option vide d'avant)", async () => {
    await ouvrirChoix(champLigne("Riz"));
    const vide = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.dataset.choixId === "")!;
    await act(async () => vide.click());
    await vi.waitFor(() => expect(modifierArticle).toHaveBeenCalledTimes(1));
    expect((modifierArticle.mock.calls[0] as [string, FormData])[1].get("fournisseurId")).toBe("");
  });

  it("action groupée : on coche des articles, on tape le fournisseur, « Appliquer » envoie les ids et le fournisseur", async () => {
    const cases = [...conteneur.querySelectorAll<HTMLInputElement>('table tbody input[type="checkbox"]')];
    await act(async () => { cases[0].click(); cases[1].click(); });
    const champ = champChoix(conteneur, "Fournisseur de l'action groupée");
    expect(champ).toBeTruthy();
    await choisirEnTapant(champ, "nord");
    const appliquer = [...conteneur.querySelectorAll("button")].filter((b) => b.textContent === "Appliquer")[1]!;
    expect(appliquer.disabled).toBe(false);
    await act(async () => appliquer.click());
    expect(enMasse).toHaveBeenCalledTimes(1);
    const [ids, four] = enMasse.mock.calls[0] as [string[], string];
    expect([...ids].sort()).toEqual(["a1", "a2"]);
    expect(four).toBe("f2");
  });

  it("une seule liste d'options pour tout le tableau : ouverte, une seule liste, tous les fournisseurs", async () => {
    await ouvrirChoix(champLigne("Farine"));
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(libellesOuverts()).toContain("Grossiste Nord");
    expect(libellesOuverts()).toHaveLength(4); // « — » + 3 fournisseurs
  });

  it("la liste flotte hors du tableau (portail) : le défilement du tableau ne la coupe pas", async () => {
    await taperChoix(champLigne("Farine"), "m");
    const liste = document.querySelector('[role="listbox"]')!;
    expect(liste.closest("table")).toBeNull();
    expect(valeurChoisie(champLigne("Farine"))).toBeUndefined(); // sans name : la valeur vit dans l'état, pas dans un champ caché
  });
});
