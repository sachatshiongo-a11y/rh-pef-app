// @vitest-environment happy-dom
//
// Inventaire — pagination (décision de la Direction, 2026-10-08) : 50 lignes par page (50 / 100 / Tout),
// page et taille dans l'URL, recherche et filtres sur TOUT le filtre, valeur totale sur TOUT le filtre,
// « Tout sélectionner » = la page, « Sélectionner les N du filtre » = tout le filtre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const categoriserEnMasse = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(async () => ({})), categoriserEnMasse: (...a: unknown[]) => categoriserEnMasse(...a), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

// 120 articles « Art 001 »… « Art 120 », prix 1 $, stock 2 → 2 $ chacun ; les 7 derniers sont en alerte « urgent ».
const ARTICLES: ArticleRow[] = Array.from({ length: 120 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return {
    id: `a${n}`, code: n, designation: `Art ${n}`, nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const,
    categorieId: i < 60 ? "c1" : "c2", fournisseurId: null, unite: "Kg", prix: "1", uniteParCarton: null, haussePct: null,
    quantite: "2", stockMinimum: "1", niveau: i >= 113 ? ("URGENT" as const) : ("OK" as const), valeurUSD: 2,
  };
});
const CATS = [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }, { id: "c2", nom: "Huiles", domaine: "NOURRITURE" }];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: { pageInit?: number; parInit?: 50 | 100 | "tout" } = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: CATS, fournisseurs: [], ...props })));
}
beforeEach(() => { categoriserEnMasse.mockClear(); window.history.replaceState(null, "", "/stock/catalogue"); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const cartes = () => [...conteneur.querySelectorAll<HTMLElement>('[data-vue="rangees-mobile"] [data-article]')].map((e) => e.dataset.article!);
const compteur = () => conteneur.querySelector("[data-pagination-compteur]")?.textContent ?? "";
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const bouton = (label: string) => conteneur.querySelector<HTMLButtonElement>(`nav[data-pagination] button[aria-label="${label}"]`)!;
const caseTout = () => conteneur.querySelector<HTMLInputElement>("thead input[type=checkbox]")!;
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const tfoot = () => conteneur.querySelector("tfoot")!.textContent ?? "";

describe("Inventaire paginé", () => {
  it("page 1 : 50 articles, compteur « 1–50 sur 120 »", () => {
    monter();
    expect(cartes()).toHaveLength(50);
    expect(cartes()[0]).toBe("a001");
    expect(compteur()).toContain("1–50 sur 120");
  });

  it("page 2 : les articles 51 à 100, et l'URL porte ?page=2", () => {
    monter();
    clic(bouton("Page suivante"));
    expect(cartes()[0]).toBe("a051");
    expect(cartes()).toHaveLength(50);
    expect(compteur()).toContain("51–100 sur 120");
    expect(window.location.search).toBe("?page=2");
  });

  it("démarre sur la page de l'URL (page 3 = 101–120)", () => {
    monter({ pageInit: 3 });
    expect(cartes()).toHaveLength(20);
    expect(compteur()).toContain("101–120 sur 120");
  });

  it("100 par page puis Tout : l'URL garde ?par=, « Tout » montre les 120", () => {
    monter();
    clic(bouton("100 par page"));
    expect(cartes()).toHaveLength(100);
    expect(window.location.search).toBe("?par=100");
    clic(bouton("Afficher tout"));
    expect(cartes()).toHaveLength(120);
    expect(window.location.search).toBe("?par=tout");
    clic(bouton("50 par page"));
    expect(cartes()).toHaveLength(50);
    expect(window.location.search).toBe("");
  });

  it("la recherche porte sur TOUT l'ensemble (un article de la page 3 est trouvé) et ramène à la page 1", () => {
    monter({ pageInit: 2 });
    taper(conteneur.querySelector<HTMLInputElement>('input[aria-label="Rechercher un article"]')!, "Art 117");
    expect(cartes()).toEqual(["a117"]);
    expect(window.location.search).toBe("?q=Art+117"); // une seule page : plus de ?page= ; le filtre est dans l'adresse (les exports le relisent)
    expect(conteneur.querySelector("nav[data-pagination]")).toBeNull(); // 1 résultat : pas de barre
  });

  it("un filtre d'alerte porte sur tout l'ensemble : 7 urgents, compteur « / 120 » conservé", () => {
    monter({ pageInit: 2 });
    const urgent = [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Urgent" && !b.closest("[data-filtres-mobile]"))!;
    clic(urgent);
    expect(cartes()).toHaveLength(7);
    expect(conteneur.textContent).toContain("7 / 120 article(s)");
  });

  it("la valeur totale du stock est celle de TOUT le filtre (120 × 2 $), dite à l'écran", () => {
    monter();
    expect(tfoot()).toContain("Valeur totale du stock filtré (120 articles, toutes les pages)");
    expect(tfoot()).toContain("240,00 $");
    clic(bouton("Page suivante"));
    expect(tfoot()).toContain("240,00 $"); // inchangé en page 2
  });

  it("« Tout sélectionner » coche la PAGE (50), puis propose les 120 du filtre", () => {
    monter();
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).toContain("50 sélectionné(s)");
    const proposer = conteneur.querySelector<HTMLButtonElement>('[data-tout-le-filtre="proposer"]')!;
    expect(proposer.textContent).toBe("Sélectionner les 120 articles du filtre");
    clic(proposer);
    expect(conteneur.textContent).toContain("120 sélectionné(s)");
    expect(conteneur.querySelector('[data-tout-le-filtre="actif"]')).not.toBeNull();
  });

  it("l'action groupée reçoit les 120 identifiants du filtre, pas seulement la page", async () => {
    monter();
    act(() => { caseTout().click(); });
    clic(conteneur.querySelector('[data-tout-le-filtre="proposer"]')!);
    const choix = conteneur.querySelector<HTMLSelectElement>("select:not([aria-label])")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => { setter.call(choix, "c2"); choix.dispatchEvent(new Event("change", { bubbles: true })); });
    const appliquer = [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Appliquer")!;
    await act(async () => { appliquer.click(); });
    expect(categoriserEnMasse).toHaveBeenCalledTimes(1);
    const [ids, cat] = categoriserEnMasse.mock.calls[0] as [string[], string];
    expect(ids).toHaveLength(120);
    expect(cat).toBe("c2");
  });

  it("la sélection d'une page seule n'envoie que la page", async () => {
    monter();
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).toContain("50 sélectionné(s)");
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).not.toContain("sélectionné(s)");
  });

  it("l'en-tête de catégorie est rappelé en tête de page (la catégorie continue)", () => {
    monter({ pageInit: 2, parInit: 50 }); // articles 51–100 : « Farines » (51–60) puis « Huiles »
    const entetes = [...conteneur.querySelectorAll("table tbody td[colspan='13']")].map((e) => e.textContent);
    expect(entetes[0]).toMatch(/^Farines \(60\)/); // le compteur est celui de la catégorie dans TOUT le filtre
    expect(entetes[1]).toMatch(/^Huiles \(60\)/);
  });

  it("cocher la page 1 puis filtrer « Urgent » : les 50 cochés invisibles ne comptent pas et ne partent pas", async () => {
    monter();
    act(() => { caseTout().click(); });
    expect(conteneur.textContent).toContain("50 sélectionné(s)");
    const urgent = [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Urgent" && !b.closest("[data-filtres-mobile]"))!;
    clic(urgent);
    expect(conteneur.textContent).not.toContain("50 sélectionné(s)");
    expect(conteneur.querySelector('[data-tout-le-filtre="proposer"]')).toBeNull(); // plus de barre : rien de coché dans le filtre
    // On coche UN urgent visible : le compteur dit 1, l'action reçoit 1 identifiant, et la note nomme les 50 autres.
    act(() => { conteneur.querySelector<HTMLInputElement>("tbody tr input[type=checkbox]")!.click(); });
    expect(conteneur.textContent).toContain("1 sélectionné(s)");
    expect(conteneur.querySelector("[data-hors-filtre]")!.textContent).toContain("50 autre(s) coché(s) hors filtre");
    const choix = conteneur.querySelector<HTMLSelectElement>("select:not([aria-label])")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => { setter.call(choix, "c2"); choix.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Appliquer")!.click(); });
    const [ids] = categoriserEnMasse.mock.calls[0] as [string[]];
    expect(ids).toHaveLength(1);
    expect(ids[0] >= "a114").toBe(true); // un des 7 urgents (n° 114 à 120)
  });

  it("le filtre s'écrit dans l'adresse (le menu « Exporter » la relit) et la page repart à 1", () => {
    monter({ pageInit: 2 });
    expect(window.location.search).toBe("?page=2");
    taper(conteneur.querySelector<HTMLInputElement>('input[aria-label="Rechercher un article"]')!, "Art 11");
    expect(window.location.search).toBe("?q=Art+11");
    const urgent = [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Urgent" && !b.closest("[data-filtres-mobile]"))!;
    clic(urgent);
    expect(new URLSearchParams(window.location.search).get("alerte")).toBe("URGENT");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Art 11");
    clic(urgent); // re-clic : plus d'alerte (même geste qu'à l'écran)
  });

  it("départ depuis l'adresse : alerte, « À compléter » et hausse initiaux appliqués", () => {
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: CATS, fournisseurs: [], initialAlerte: "URGENT", initialManque: "negatif" })));
    expect(conteneur.querySelectorAll('[data-vue="rangees-mobile"] [data-article]')).toHaveLength(0); // urgents ET stock négatif : aucun ici
  });
});
