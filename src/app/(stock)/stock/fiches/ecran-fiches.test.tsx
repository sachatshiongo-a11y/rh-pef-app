// @vitest-environment happy-dom
//
// Écran Fiches techniques : onglets Plats / Boissons, sections des boissons (rangées par la
// RUBRIQUE), type prérempli à la création, actions groupées bornées à l'onglet affiché.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({
  creerFiche: vi.fn<(fd: FormData) => Promise<{ id: string }>>(async () => ({ id: "nouvelle" })),
  supprimerFiches: vi.fn<(ids: string[]) => Promise<void>>(async () => {}),
  dupliquerFiches: vi.fn<(ids: string[]) => Promise<{ ids: string[] }>>(async () => ({ ids: [] })),
}));
vi.mock("./actions", () => appels);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { EcranFiches } = await import("./ecran-fiches");
type Props = Parameters<typeof EcranFiches>[0];
type FicheRow = Props["rows"][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: FicheRow = {
  id: "f", nom: "?", categorie: "", type: "PLAT",
  estSousRecette: false, actif: true, photoUrl: null, nbPortions: 1, nbIngredients: 2,
  coutPortion: 1.61, coutConnu: true, coutPartiel: false, incomplet: false,
  nbIndetermines: 0, prixVenteHT: 20.24, prixEstConseille: true, tauxMarque: 0.875,
  dispo: { etat: "DISPONIBLE", portions: 23, limitant: null, enRupture: [], raisons: [], rendement: null },
};
const fiche = (o: Partial<FicheRow>): FicheRow => ({ ...base, ...o });

const ROWS: FicheRow[] = [
  fiche({ id: "p-bolo", nom: "Bolognaise", categorie: "Pâtes classiques", type: "PLAT" }),
  fiche({ id: "p-sauce", nom: "Sauce tomate", categorie: "Bases", type: "PLAT", estSousRecette: true }),
  // Une fiche SANS recette : la mention « recette à compléter » et le coût « — » restent.
  fiche({ id: "p-vide", nom: "Lasagne", categorie: "Four", type: "PLAT", nbIngredients: 0, coutConnu: false, coutPortion: 0, incomplet: true }),
  fiche({ id: "b-mojito", nom: "Mojito", categorie: "Cocktail", type: "BAR" }),
  fiche({ id: "b-virgin", nom: "Virgin colada", categorie: "Mocktails", type: "BAR" }),
  fiche({ id: "b-bordeaux", nom: "Bordeaux", categorie: "Vin rouge", type: "BAR" }),
  // Le NOM évoque un cocktail, la rubrique dit « Rhum » : c'est la rubrique qui range.
  fiche({ id: "b-rhum", nom: "Rhum cocktail maison", categorie: "Rhum", type: "BAR" }),
  fiche({ id: "b-eau", nom: "Eau plate 50 cl", categorie: "", type: "BAR" }),
];

let conteneur: HTMLDivElement;
let racine: Root;
function rendre(props: Props) {
  act(() => racine.render(createElement(EcranFiches, props)));
}
beforeEach(() => {
  for (const f of Object.values(appels)) f.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => racine.unmount());
  conteneur.remove();
});

const nomsAffiches = () => [...conteneur.querySelectorAll("li a.font-medium")].map((a) => a.textContent);
const nomsDeSection = (cle: string) =>
  [...conteneur.querySelectorAll(`section[data-section="${cle}"] li a.font-medium`)].map((a) => a.textContent);
const bouton = (texte: string) =>
  [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte)) as HTMLButtonElement;
const clic = (el: Element) => act(() => { (el as HTMLElement).click(); });

describe("Fiches techniques — onglets Plats / Boissons", () => {
  it("les deux onglets portent l'URL et leur nombre de fiches ; l'onglet affiché est marqué", () => {
    rendre({ rows: ROWS, vue: "plats" });
    const liens = [...conteneur.querySelectorAll('nav[aria-label="Onglets des fiches"] a')];
    expect(liens.map((a) => a.getAttribute("href"))).toEqual(["/stock/fiches?vue=plats", "/stock/fiches?vue=boissons"]);
    expect(liens.map((a) => a.textContent)).toEqual(["Plats · 3", "Boissons · 5"]);
    expect(liens[0].getAttribute("aria-current")).toBe("page");
    expect(liens[1].getAttribute("aria-current")).toBeNull();
  });

  it("Plats : les plats ET les sous-recettes (avec leur repère), jamais une boisson", () => {
    rendre({ rows: ROWS, vue: "plats" });
    expect(nomsAffiches()).toEqual(["Bolognaise", "Sauce tomate", "Lasagne"]);
    for (const b of ["Mojito", "Virgin colada", "Bordeaux", "Rhum cocktail maison", "Eau plate 50 cl"]) {
      expect(conteneur.textContent).not.toContain(b);
    }
    expect(conteneur.textContent).toContain("Sous-recette");
    // Aucune section « Cocktails » côté plats.
    expect(conteneur.querySelector('section[data-section="COCKTAIL"]')).toBeNull();
  });

  it("Boissons : deux sections rangées par la RUBRIQUE, cocktails & mocktails d'abord", () => {
    rendre({ rows: ROWS, vue: "boissons" });
    const titres = [...conteneur.querySelectorAll("section h2")].map((h) => h.textContent);
    expect(titres).toEqual(["Cocktails & mocktails 2 fiche(s)", "Boissons 3 fiche(s)"]);
    expect(nomsDeSection("COCKTAIL")).toEqual(["Mojito", "Virgin colada"]);
    expect(nomsDeSection("BOISSON")).toEqual(["Bordeaux", "Rhum cocktail maison", "Eau plate 50 cl"]);
    expect(conteneur.textContent).not.toContain("Bolognaise");
    expect(conteneur.textContent).not.toContain("Sauce tomate");
  });

  it("les compteurs, l'export et « recette à compléter » suivent l'onglet", () => {
    rendre({ rows: ROWS, vue: "plats" });
    expect(conteneur.querySelector("[data-compteur-onglet]")!.textContent).toBe("3 fiche(s) · 1 recette(s) à compléter");
    expect(conteneur.textContent).toContain("Aucun ingrédient saisi");
    expect(conteneur.textContent).toContain("—");
    rendre({ rows: ROWS, vue: "boissons" });
    expect(conteneur.querySelector("[data-compteur-onglet]")!.textContent).toBe("5 fiche(s)");
    expect(conteneur.textContent).toContain("5 / 5 fiche(s)");
  });

  it("la recherche ne cherche que dans l'onglet affiché", () => {
    rendre({ rows: ROWS, vue: "boissons" });
    const champ = conteneur.querySelector<HTMLInputElement>('input[aria-label="Rechercher"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(champ, "bo"); champ.dispatchEvent(new Event("input", { bubbles: true })); });
    // « bo » trouverait « Bolognaise » côté plats : ici, seul « Bordeaux ».
    expect(nomsAffiches()).toEqual(["Bordeaux"]);
  });

  it("le filtre de catégorie ne propose que les rubriques de l'onglet", () => {
    rendre({ rows: ROWS, vue: "boissons" });
    const options = [...conteneur.querySelectorAll("select")][0].querySelectorAll("option");
    expect([...options].map((o) => o.textContent)).toEqual(["Toutes les catégories", "Cocktail", "Mocktails", "Rhum", "Vin rouge"]);
  });
});

describe("Fiches techniques — création : le type est prérempli par l'onglet", () => {
  it("Boissons → Bar, sans case sous-recette", () => {
    rendre({ rows: ROWS, vue: "boissons" });
    clic(bouton("Nouvelle fiche"));
    const form = conteneur.querySelector<HTMLFormElement>('form[aria-label="Nouvelle fiche"]')!;
    expect(form.querySelector<HTMLSelectElement>('select[name="type"]')!.value).toBe("BAR");
    expect(form.querySelector('input[name="estSousRecette"]')).toBeNull();
  });

  it("Plats → Plat, avec la case sous-recette", () => {
    rendre({ rows: ROWS, vue: "plats" });
    clic(bouton("Nouvelle fiche"));
    const form = conteneur.querySelector<HTMLFormElement>('form[aria-label="Nouvelle fiche"]')!;
    expect(form.querySelector<HTMLSelectElement>('select[name="type"]')!.value).toBe("PLAT");
    expect(form.querySelector('input[name="estSousRecette"]')).not.toBeNull();
  });

  it("le formulaire envoie le type prérempli à creerFiche", async () => {
    rendre({ rows: ROWS, vue: "boissons" });
    clic(bouton("Nouvelle fiche"));
    const form = conteneur.querySelector<HTMLFormElement>('form[aria-label="Nouvelle fiche"]')!;
    form.querySelector<HTMLInputElement>('input[name="nom"]')!.value = "Caïpirinha";
    await act(async () => { form.requestSubmit(); });
    expect(appels.creerFiche).toHaveBeenCalledTimes(1);
    const fd = appels.creerFiche.mock.calls[0][0];
    expect(fd.get("type")).toBe("BAR");
    expect(fd.get("nom")).toBe("Caïpirinha");
  });
});

describe("Fiches techniques — les actions groupées ne portent que sur l'onglet affiché", () => {
  const toutSelectionner = () => {
    const c = [...conteneur.querySelectorAll("label")].find((l) => l.textContent?.includes("Tout sélectionner"))!.querySelector("input")!;
    clic(c);
  };
  const lienExport = () => [...conteneur.querySelectorAll("a")].find((a) => a.textContent?.includes("Exporter ("))!;

  it("« Tout sélectionner » dans Boissons ne prend que les boissons (export, dupliquer, supprimer)", async () => {
    rendre({ rows: ROWS, vue: "boissons" });
    toutSelectionner();
    expect(conteneur.textContent).toContain("5 sélectionné(s)");
    const ids = new URL(lienExport().href, "http://x").searchParams.get("ids")!.split(",").sort();
    expect(ids).toEqual(["b-bordeaux", "b-eau", "b-mojito", "b-rhum", "b-virgin"]);
    expect(new URL(lienExport().href, "http://x").searchParams.get("vue")).toBe("boissons");

    await act(async () => { bouton("Dupliquer").click(); });
    expect(appels.dupliquerFiches.mock.calls[0][0].slice().sort()).toEqual(ids);

    toutSelectionner();
    vi.stubGlobal("confirm", () => true);
    await act(async () => { bouton("Supprimer").click(); });
    expect(appels.supprimerFiches.mock.calls[0][0].slice().sort()).toEqual(ids);
  });

  it("changer d'onglet vide la sélection : rien de Boissons ne part avec une action dans Plats", async () => {
    rendre({ rows: ROWS, vue: "boissons" });
    toutSelectionner();
    expect(conteneur.textContent).toContain("5 sélectionné(s)");
    rendre({ rows: ROWS, vue: "plats" });
    expect(conteneur.textContent).toContain("0 sélectionné(s)");
    // Une nouvelle sélection dans Plats ne contient que des plats.
    toutSelectionner();
    await act(async () => { bouton("Dupliquer").click(); });
    expect(appels.dupliquerFiches.mock.calls[0][0].slice().sort()).toEqual(["p-bolo", "p-sauce", "p-vide"]);
  });
});
