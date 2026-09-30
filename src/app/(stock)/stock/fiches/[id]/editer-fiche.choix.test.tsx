// @vitest-environment happy-dom
//
// Fiche technique : la source d'une ligne (article OU sous-recette) se choisit en TAPANT son nom,
// dans une liste groupée (sous-recettes, articles du stock, autres fiches) ; même valeur qu'avant
// (`art:<id>` / `fiche:<id>`), articles inactifs toujours proposés et marqués.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { champChoix, choisirEnTapant, choisirOption, libellesOuverts, listeOuverte, taperChoix, valeurChoisie } from "@/lib/test/choix-recherche";

vi.mock("../actions", () => ({
  ajouterIngredient: vi.fn(), dupliquerFiches: vi.fn(), modifierFiche: vi.fn(), remplacerIngredients: vi.fn(),
  supprimerFiches: vi.fn(), supprimerIngredients: vi.fn(),
}));
vi.mock("../photo-actions", () => ({ envoyerPhotoFiche: vi.fn(), supprimerPhotoFiche: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { EditerFiche } = await import("./editer-fiche");
type Props = Parameters<typeof EditerFiche>[0];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROPS: Props = {
  vue: {
    id: "mojito", nom: "Mojito", categorie: "Cocktail", type: "BAR", nbPortions: 1, tauxTVA: "0.16", prixVenteTTC: "12",
    coefficientMargeCible: "", estSousRecette: false, rendementQuantite: "", rendementUnite: "", recette: "",
    actif: true, photoUrl: null,
    lignes: [{ id: "l1", articleId: "rhum", sousFicheId: null, unite: "cl", quantite: "5", ordre: 1 }],
  },
  articles: [
    { id: "rhum", designation: "Rhum blanc", unite: "Bouteille", prixUnitaireUSD: "14", actif: true, contenance: "70", contenanceUnite: "cl" },
    { id: "citron", designation: "Citron vert", nomCourt: "Lime", code: "C12", unite: "Kg", prixUnitaireUSD: "3", actif: true },
    { id: "vieux", designation: "Vieux rhum ambré", unite: "Bouteille", prixUnitaireUSD: "20", actif: false, contenance: "70", contenanceUnite: "cl" },
  ],
  autresFiches: [{ id: "sirop", nom: "Sirop de sucre", estSousRecette: true }, { id: "pina", nom: "Piña colada", estSousRecette: false }],
  contexte: [], contexteDispo: [], stocks: {}, aujourdhui: "2026-09-30",
};

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(EditerFiche, PROPS)));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

const ligne = () => champChoix(conteneur, "Article ou sous-recette de la ligne");
const ajout = () => conteneur.querySelector<HTMLInputElement>('input[role="combobox"][data-choix-recherche="source"]:not([aria-label])')!;

describe("fiche technique — choisir la source d'une ligne en tapant", () => {
  it("la ligne existante affiche son article ; aucun <select> de source ne subsiste", () => {
    expect(ligne().value).toBe("Rhum blanc");
    expect(valeurChoisie(ligne())).toBeUndefined(); // pas de champ caché : la ligne est dans l'état de la fiche
    expect(conteneur.querySelectorAll("select[name=source]")).toHaveLength(0);
  });

  it("taper change l'article de la ligne (lien vers sa fiche catalogue, « non enregistré »)", async () => {
    await choisirEnTapant(ligne(), "lime"); // nom court
    expect(ligne().value).toBe("Citron vert");
    expect(conteneur.querySelector('a[href="/stock/catalogue/citron"]')).not.toBeNull();
    expect(conteneur.textContent).toContain("non enregistré");
  });

  it("liste groupée ; un article inactif reste proposé, marqué « (inactif) » ; on cherche par code", async () => {
    await taperChoix(ligne(), "");
    const textes = listeOuverte()!.textContent!;
    expect(textes.indexOf("Sous-recettes")).toBeLessThan(textes.indexOf("Articles du stock"));
    expect(textes.indexOf("Articles du stock")).toBeLessThan(textes.indexOf("Autres fiches"));
    expect(libellesOuverts()).toEqual(["— choisir —", "Sirop de sucre", "Rhum blanc", "Citron vert", "Vieux rhum ambré (inactif)", "Piña colada"]);
    await taperChoix(ligne(), "c12");
    expect(libellesOuverts()).toEqual(["Citron vert"]);
    await taperChoix(ligne(), "rhum ambre");
    expect(libellesOuverts()).toEqual(["Vieux rhum ambré (inactif)"]);
  });

  it("formulaire d'ajout : une sous-recette tapée part dans `source` sous la forme fiche:<id>", async () => {
    await choisirEnTapant(ajout(), "sirop");
    expect(valeurChoisie(ajout())).toBe("fiche:sirop");
    const form = ajout().closest("form")!;
    expect(new FormData(form).get("source")).toBe("fiche:sirop");
    expect(ajout().required).toBe(true);
  });

  it("formulaire d'ajout : un article choisi à la souris part en art:<id>", async () => {
    await choisirOption(ajout(), "art:citron");
    expect(new FormData(ajout().closest("form")!).get("source")).toBe("art:citron");
  });
});
