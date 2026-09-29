// @vitest-environment happy-dom
//
// Inventaire sur téléphone (demande de la Direction, 2026-09-29) : chaque article est UNE rangée
// compacte où le stock (quantité + unité) saute aux yeux, colorée selon le niveau d'alerte ; un appui
// déplie les champs éditables (même enregistrement qu'avant). L'ordinateur garde son tableau.
// Ce que ces tests ne voient pas : les hauteurs réelles et le débordement à 375 px (vérifiés à l'œil).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modifierArticle = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: (...a: unknown[]) => modifierArticle(...a), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(),
  basculerActifArticles: vi.fn(), basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(),
  corrigerStocksNegatifs: vi.fn(),
}));

const { CatalogueTable, etatStock } = await import("./catalogue-table");
type ArticleRow = Parameters<typeof CatalogueTable>[0]["articles"][number];

const base = { code: null, nomCourt: null, surFicheCommande: false, domaine: "NOURRITURE" as const, categorieId: "c1", fournisseurId: null, uniteParCarton: null, prix: "2", haussePct: null };
const ARTICLES: ArticleRow[] = [
  { ...base, id: "ok", designation: "Riz", unite: "Kg", quantite: "78", stockMinimum: "20", niveau: "OK" },
  { ...base, id: "bas", designation: "Farine", nomCourt: "Farine T55", unite: "Kg", quantite: "4.83", stockMinimum: "5", niveau: "APPRO" },
  { ...base, id: "rupture", designation: "Beurre", unite: "Kg", quantite: "0", stockMinimum: "3", niveau: "URGENT" },
  { ...base, id: "negatif", designation: "Sucre", unite: "Kg", quantite: "-2.5", stockMinimum: "0", niveau: "OK" },
  { ...base, id: "inconnu", designation: "Amidon", unite: null, quantite: "0", stockMinimum: "0", niveau: null },
];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  modifierArticle.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueTable, { articles: ARTICLES, categories: [{ id: "c1", nom: "Farines", domaine: "NOURRITURE" }], fournisseurs: [] })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const mobile = () => conteneur.querySelector<HTMLElement>('[data-vue="rangees-mobile"]')!;
const rangee = (id: string) => mobile().querySelector<HTMLElement>(`[data-article="${id}"]`)!;
const stock = (id: string) => rangee(id).querySelector<HTMLElement>("[data-stock]")!;
const bouton = (id: string) => rangee(id).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const clic = (el: HTMLElement) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const noms = () => [...mobile().querySelectorAll<HTMLElement>("[data-article]")].map((e) => e.dataset.article);

describe("rangée compacte — le stock en évidence", () => {
  it("affiche la quantité et l'unité, à la française", () => {
    expect(stock("bas").textContent).toBe("4,83Kg");
    expect(stock("ok").textContent).toBe("78Kg");
    expect(stock("bas").className).toMatch(/text-xl.*font-bold|font-bold.*text-xl/);
  });

  it("colore selon l'état : rupture rouge, sous le seuil ambre, correct neutre", () => {
    expect(stock("rupture").className).toContain("text-red-700");
    expect(stock("bas").className).toContain("text-amber-700");
    expect(stock("ok").className).toContain("text-foreground");
    expect(stock("ok").className).not.toMatch(/text-(red|amber)/);
  });

  it("reprend les libellés du badge (« À réapprovisionner », « Urgent »), et rien pour un article correct", () => {
    expect(rangee("bas").textContent).toContain("À réapprovisionner");
    expect(rangee("rupture").textContent).toContain("Urgent");
    expect(rangee("ok").textContent).not.toMatch(/Satisfaisant|Urgent|réapprovisionner/);
  });

  it("montre le seuil en petit et le nom court sous le nom", () => {
    expect(rangee("bas").textContent).toContain("min. 5");
    expect(rangee("bas").textContent).toContain("Farine T55");
    expect(rangee("negatif").textContent).toContain("sans seuil");
  });

  it("une quantité inconnue s'affiche « — », jamais 0", () => {
    expect(stock("inconnu").textContent).toBe("—");
    expect(stock("inconnu").className).not.toMatch(/text-(red|amber)/);
  });

  it("un stock négatif reste visible, en rouge et signalé", () => {
    expect(stock("negatif").textContent).toBe("-2,5Kg");
    expect(stock("negatif").className).toContain("text-red-700");
    expect(rangee("negatif").textContent).toContain("Négatif");
  });

  it("garde la case des actions groupées, avec une zone de 44 px", () => {
    const case_ = rangee("ok").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(case_.closest("label")!.className).toContain("w-11");
    clic(case_);
    expect(conteneur.textContent).toContain("1 sélectionné(s)");
  });

  it("etatStock : n'invente aucun seuil, il lit le niveau d'alerte", () => {
    expect(etatStock({ quantite: "0", niveau: "OK" }).ton).toBe("ok"); // pas de seuil défini → pas d'alerte
    expect(etatStock({ quantite: "3", niveau: "URGENT" }).ton).toBe("rupture");
    expect(etatStock({ quantite: "3", niveau: "APPRO" }).ton).toBe("bas");
    expect(etatStock({ quantite: "", niveau: "OK" }).inconnu).toBe(true);
    expect(etatStock({ quantite: "-1", niveau: "OK" })).toMatchObject({ negatif: true, ton: "rupture" });
  });
});

describe("dépliage des champs éditables", () => {
  it("replié : aucun champ de saisie dans la rangée", () => {
    expect(rangee("bas").querySelector("input:not([type=checkbox])")).toBeNull();
    expect(bouton("bas").getAttribute("aria-expanded")).toBe("false");
  });

  it("un appui déplie les champs, un second les replie", () => {
    clic(bouton("bas"));
    expect(bouton("bas").getAttribute("aria-expanded")).toBe("true");
    expect(rangee("bas").querySelector('[aria-label="Stock minimum — Farine"]')).not.toBeNull();
    expect(rangee("bas").querySelector('[aria-label="Nom court — Farine"]')).not.toBeNull();
    expect(rangee("bas").querySelector('a[href="/stock/catalogue/bas"]')).not.toBeNull();
    clic(bouton("bas"));
    expect(rangee("bas").querySelector('[aria-label="Stock minimum — Farine"]')).toBeNull();
  });

  it("un seul article déplié à la fois", () => {
    clic(bouton("bas"));
    clic(bouton("ok"));
    expect(mobile().querySelectorAll('[aria-expanded="true"]').length).toBe(1);
    expect(bouton("ok").getAttribute("aria-expanded")).toBe("true");
  });

  it("enregistre comme avant : au blur, modifierArticle(id, FormData) avec le champ modifié", async () => {
    clic(bouton("bas"));
    const champ = rangee("bas").querySelector<HTMLInputElement>('[aria-label="Nom court — Farine"]')!;
    champ.value = "Farine 25 Kg";
    await act(async () => { champ.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(modifierArticle).toHaveBeenCalledTimes(1);
    const [id, fd] = modifierArticle.mock.calls[0] as [string, FormData];
    expect(id).toBe("bas");
    expect(fd.get("nomCourt")).toBe("Farine 25 Kg");
  });

  it("n'enregistre rien si la valeur n'a pas changé", async () => {
    clic(bouton("bas"));
    const champ = rangee("bas").querySelector<HTMLInputElement>('[aria-label="Nom court — Farine"]')!;
    await act(async () => { champ.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(modifierArticle).not.toHaveBeenCalled();
  });
});

describe("tri sur téléphone", () => {
  const tri = () => conteneur.querySelector<HTMLSelectElement>('select[aria-label="Trier les articles"]')!;
  const choisir = (v: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(tri(), v);
    tri().dispatchEvent(new Event("change", { bubbles: true }));
  });

  it("propose « stock bas » et classe le plus bas d'abord (même tri que la colonne Stock de l'ordinateur)", () => {
    expect([...tri().options].map((o) => o.value)).toContain("stock:1");
    choisir("stock:1");
    expect(noms()).toEqual(["negatif", "rupture", "inconnu", "bas", "ok"]);
    choisir("stock:-1");
    expect(noms()[0]).toBe("ok");
    choisir("");
    expect(noms()).toEqual(["ok", "bas", "rupture", "negatif", "inconnu"]);
  });

  it("le tri est masqué sur ordinateur (lg:hidden)", () => {
    expect(tri().closest("label")!.className).toContain("lg:hidden");
  });
});

describe("ordinateur inchangé", () => {
  it("le tableau est rendu par LigneArticle : une ligne par article, avec ses champs, masqué sur téléphone", () => {
    const bloc = conteneur.querySelector("table")!.parentElement!;
    expect(bloc.className).toMatch(/hidden.*lg:block/);
    expect(mobile().className).toContain("lg:hidden");
    const lignes = [...bloc.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector('input[type="checkbox"]'));
    expect(lignes.length).toBe(ARTICLES.length);
    expect(lignes[0].querySelector('[title="Code article"]')).not.toBeNull();
    expect(lignes[0].querySelector('[aria-label="Stock minimum — Riz"]')).not.toBeNull();
  });
});
