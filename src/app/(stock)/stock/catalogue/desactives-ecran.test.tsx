// @vitest-environment happy-dom
//
// Articles désactivés dans l'Inventaire (décision de la Direction, 2026-10-14) : MASQUÉS par défaut dans tous les onglets de
// domaine ; une pastille « Désactivés (N) » parmi les pastilles de filtre les montre, chacun avec une pastille grise « Inactif » ;
// dans cette vue, « Activer » (action groupée existante) les réactive ; les compteurs, bandeaux et valeur n'additionnent que les
// articles ACTIFS ; la vue s'écrit dans l'adresse (`?inactifs=1`), d'où les exports la lisent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = vi.hoisted(() => ({ basculerActif: vi.fn<(...a: unknown[]) => Promise<unknown>>() }));
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(), changerDomaineEnMasse: vi.fn(),
  basculerActifArticles: (...a: unknown[]) => A.basculerActif(...a), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), ajouterFournisseurEnMasse: vi.fn(), retirerFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(), changerUniteEnMasse: vi.fn(), apercuSuppressionArticles: vi.fn(), supprimerArticlesEnMasse: vi.fn(),
}));
const { CatalogueEcran } = await import("./catalogue-ecran");
type Ligne = Parameters<typeof CatalogueEcran>[0]["rows"][number];

const base = { code: null, domaine: "NOURRITURE" as const, categorieId: "c1", fournisseurId: null, uniteParCarton: null, prix: "2", unite: "Kg", stockMinimum: "5" };
const ROWS: Ligne[] = [
  { ...base, id: "a1", designation: "Riz", quantite: "50", niveau: "OK" },
  { ...base, id: "a2", designation: "Farine", quantite: "0", niveau: "URGENT" },
  { ...base, id: "a3", designation: "Sucre", quantite: "3", niveau: "APPRO", haussePct: 12 },
  { ...base, id: "i1", designation: "Ancien sirop", quantite: "0", niveau: "URGENT", actif: false, haussePct: 30, unite: null },
  { ...base, id: "i2", designation: "Vieille huile", quantite: "30", niveau: "OK", actif: false, domaine: "BOISSON" },
];

let conteneur: HTMLDivElement;
let racine: Root;
const monter = (props: Partial<Parameters<typeof CatalogueEcran>[0]> = {}) => act(() => racine.render(h(CatalogueEcran, { rows: ROWS, categories: [{ id: "c1", nom: "Épicerie", domaine: "NOURRITURE" }], fournisseurs: [], q: "", ...props })));
beforeEach(() => {
  A.basculerActif.mockReset(); A.basculerActif.mockResolvedValue(undefined);
  window.history.replaceState(null, "", "/stock/catalogue");
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

const noms = () => [...conteneur.querySelectorAll("table tbody tr")].map((tr) => tr.querySelector("a")?.textContent).filter(Boolean);
const bouton = (t: string | RegExp) => [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof t === "string" ? b.textContent === t : t.test(b.textContent ?? "")));
const cliquer = async (el: HTMLElement | undefined) => { expect(el, "élément introuvable").toBeTruthy(); await act(async () => { el!.click(); }); };

describe("masqués par défaut, dans tous les onglets", () => {
  it("l'Inventaire ne montre que les articles actifs ; aucun badge « Inactif » ; la pastille annonce le nombre de désactivés", () => {
    monter();
    expect(noms()).toEqual(["Riz", "Farine", "Sucre"]);
    expect(conteneur.querySelector("[data-badge-inactif]")).toBeNull();
    expect(bouton("Désactivés (2)")).toBeTruthy();
  });

  it("onglet de domaine : la pastille compte les désactivés du domaine, et eux seuls sont listés", async () => {
    monter({ domaine: "BOISSON", rows: ROWS.filter((r) => r.domaine === "BOISSON") });
    expect(noms()).toEqual([]); // la seule boisson est désactivée
    expect(bouton("Désactivés (1)")).toBeTruthy();
    await cliquer(bouton("Désactivés (1)"));
    expect(noms()).toEqual(["Vieille huile"]);
  });

  it("sans article désactivé : pas de pastille", () => {
    monter({ rows: ROWS.filter((r) => r.actif !== false) });
    expect(bouton(/^Désactivés/)).toBeUndefined();
  });
});

describe("la pastille « Désactivés » : filtre, badge, réactivation", () => {
  it("affiche les désactivés seuls, chacun avec la pastille grise « Inactif » (couleur + libellé) ; la pastille se referme", async () => {
    monter();
    await cliquer(bouton("Désactivés (2)"));
    expect(noms()).toEqual(["Ancien sirop", "Vieille huile"]);
    const badges = [...conteneur.querySelectorAll("table [data-badge-inactif]")];
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe("Inactif");
    expect(badges[0].className).toMatch(/bg-gray-200/);
    expect(badges[0].className).toMatch(/text-gray-700/);
    expect(bouton("Désactivés (2)")!.getAttribute("aria-pressed")).toBe("true");
    expect(conteneur.textContent).toContain("2 / 2 article(s) désactivé(s)");
    await cliquer(bouton("Désactivés (2)"));
    expect(noms()).toEqual(["Riz", "Farine", "Sucre"]);
  });

  it("le badge « Inactif » figure aussi sur la carte du téléphone", async () => {
    monter();
    await cliquer(bouton("Désactivés (2)"));
    expect(conteneur.querySelectorAll('[data-vue="rangees-mobile"] [data-badge-inactif]')).toHaveLength(2);
  });

  it("dans cette vue, « Activer » réactive les articles cochés (action groupée existante) ; le nom reste cliquable vers la fiche", async () => {
    monter();
    await cliquer(bouton("Désactivés (2)"));
    expect(conteneur.querySelector('table a[href="/stock/catalogue/i1"]')!.textContent).toBe("Ancien sirop");
    await act(async () => { conteneur.querySelector<HTMLInputElement>('table tbody input[type="checkbox"]')!.click(); });
    await cliquer(bouton("Activer"));
    expect(A.basculerActif).toHaveBeenCalledWith(["i1"], true);
  });

  it("la vue s'écrit dans l'adresse (?inactifs=1) — d'où les exports la lisent — et se retire en la quittant", async () => {
    monter();
    await cliquer(bouton("Désactivés (2)"));
    expect(new URL(window.location.href).searchParams.get("inactifs")).toBe("1");
    await cliquer(bouton("Désactivés (2)"));
    expect(new URL(window.location.href).searchParams.has("inactifs")).toBe(false);
  });

  it("ouverte depuis l'adresse (?inactifs=1) : la vue « Désactivés » est déjà là", () => {
    monter({ inactifs: true });
    expect(noms()).toEqual(["Ancien sirop", "Vieille huile"]);
  });

  it("dans la vue « Désactivés », les filtres d'alerte et d'à compléter (qui parlent des actifs) ne sont pas proposés", async () => {
    monter();
    expect(conteneur.textContent).toContain("À réapprovisionner");
    await cliquer(bouton("Désactivés (2)"));
    expect(conteneur.textContent).not.toContain("À réapprovisionner");
    expect(conteneur.textContent).not.toContain("Hausse de prix d'achat");
    expect(bouton("Urgent")).toBeUndefined();
  });
});

describe("compteurs : les articles ACTIFS seulement", () => {
  it("bandeau « À réapprovisionner » : 1 urgent (Farine) et 1 à réapprovisionner (Sucre) — pas l'Ancien sirop désactivé en rupture", () => {
    monter();
    const bandeau = [...conteneur.querySelectorAll("div")].find((d) => d.textContent!.startsWith("⚠ À réapprovisionner") && d.className.includes("rounded-xl"))!;
    expect(bandeau.textContent).toContain("1 urgent");
    expect(bandeau.textContent).toContain("1 à réappro.");
  });

  it("hausse de prix : 1 article (Sucre) ; le désactivé en hausse (+30 %) n'est pas compté", () => {
    monter();
    const bandeau = [...conteneur.querySelectorAll("div")].find((d) => d.textContent!.startsWith("📈 Hausse de prix d'achat"))!;
    expect(bandeau.textContent).toContain("1 article");
  });

  it("« À compléter » : 'sans unité' ignore l'Ancien sirop désactivé (unité absente)", () => {
    monter();
    expect(conteneur.textContent).not.toContain("sans unité");
  });

  it("en-tête : la valeur du stock et le nombre d'articles n'additionnent que les actifs (53 × 2 $ = 106 $ ; 3 articles)", () => {
    monter();
    const droite = [...conteneur.querySelectorAll("div")].find((d) => d.textContent!.startsWith("Valeur du stock") && d.className.includes("max-lg:hidden"))!;
    expect(droite.textContent).toContain("3 article(s)");
    expect(droite.textContent).toMatch(/106[,.]00\s*\$|106\s*\$/);
    expect(droite.textContent).not.toMatch(/166/); // + 30 × 2 $ de la vieille huile désactivée
  });
});
