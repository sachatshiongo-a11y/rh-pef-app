// @vitest-environment happy-dom
//
// En-tête de l'Inventaire (demande de la Direction, 2026-09-29) : sur téléphone, titre réduit et
// domaines sur UNE ligne ; valeur du stock, compteur et export rangés dans « Plus » (le tableau les y
// reprend) ; sur ordinateur, l'en-tête d'origine. Les hauteurs réelles se vérifient dans un navigateur.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./actions", () => ({
  creerArticle: vi.fn(), modifierArticle: vi.fn(), categoriserEnMasse: vi.fn(), fusionnerArticles: vi.fn(), basculerActifArticles: vi.fn(),
  basculerFicheCommande: vi.fn(), definirFournisseurEnMasse: vi.fn(), definirSeuilEnMasse: vi.fn(), corrigerStocksNegatifs: vi.fn(),
}));
const { CatalogueEcran } = await import("./catalogue-ecran");

const rows = [{ id: "a", code: null, designation: "Riz", domaine: "NOURRITURE" as const, categorieId: null, fournisseurId: null, unite: "Kg", prix: "2", uniteParCarton: null, quantite: "10", stockMinimum: "5", niveau: "OK" as const }];
let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CatalogueEcran, { rows, categories: [], fournisseurs: [], q: "" })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

describe("en-tête de l'Inventaire", () => {
  it("titre réduit sur téléphone, grand dès sm ; les quatre domaines restent des liens", () => {
    const titre = conteneur.querySelector("h1")!;
    expect(titre.textContent).toBe("Inventaire");
    expect(titre.className).toMatch(/text-lg/);
    expect(titre.className).toContain("sm:text-2xl");
    const liens = [...conteneur.querySelectorAll("a")].map((a) => a.textContent);
    expect(liens).toEqual(expect.arrayContaining(["Nourriture", "Boissons", "Autre"]));
  });

  it("valeur du stock, compteur et export : masqués sur téléphone dans l'en-tête, repris dans « Plus »", () => {
    const droite = [...conteneur.querySelectorAll("div")].find((d) => d.textContent!.startsWith("Valeur du stock") && d.className.includes("max-lg:hidden"))!;
    expect(droite, "bloc de droite réservé à l'ordinateur").toBeTruthy();
    expect(droite.textContent).toContain("1 article(s)");
    expect(droite.textContent).toContain("Exporter");
    const plus = conteneur.querySelector<HTMLButtonElement>('button[aria-controls="inventaire-plus"]')!;
    act(() => { plus.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const panneau = conteneur.querySelector("#inventaire-plus")!;
    expect(panneau.textContent).toContain("Valeur du stock");
    expect(panneau.textContent).toContain("Exporter");
  });
});
