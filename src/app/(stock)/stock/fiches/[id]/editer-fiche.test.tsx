// @vitest-environment happy-dom
//
// Page d'une fiche : les boutons PDF reprennent la fiche ENREGISTRÉE. Tant qu'une modification n'est
// pas enregistrée (entête ou ingrédient), ils sont désactivés et le disent — sinon le PDF montrerait
// autre chose que l'écran.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

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
    coefficientMargeCible: "", estSousRecette: false, rendementQuantite: "", rendementUnite: "", recette: "Verre : Tumbler",
    actif: true, photoUrl: null,
    lignes: [{ id: "l1", articleId: "rhum", sousFicheId: null, unite: "cl", quantite: "5", ordre: 1 }],
  },
  articles: [{ id: "rhum", designation: "Rhum blanc", unite: "Bouteille", prixUnitaireUSD: "14", actif: true, contenance: "70", contenanceUnite: "cl" }],
  autresFiches: [], contexte: [], contexteDispo: [], stocks: {}, aujourdhui: "2026-09-30",
};

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(EditerFiche, PROPS)));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const boutonsPdf = () => [...conteneur.querySelectorAll("button")].filter((b) => /^PDF/.test(b.textContent ?? ""));
const saisir = (el: HTMLInputElement | HTMLTextAreaElement, valeur: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valeur); el.dispatchEvent(new Event("input", { bubbles: true })); });
};

describe("page d'une fiche — boutons PDF", () => {
  it("fiche enregistrée : « PDF » et « PDF sans prix » actifs", () => {
    expect(boutonsPdf().map((b) => [b.textContent, b.disabled])).toEqual([["PDF", false], ["PDF sans prix", false]]);
  });

  it("entête modifiée (technique) : désactivés, « enregistrez d'abord »", () => {
    saisir(conteneur.querySelector<HTMLTextAreaElement>('textarea[name="recette"]')!, "Verre : Highball");
    for (const b of boutonsPdf()) {
      expect(b.disabled, b.textContent!).toBe(true);
      expect(b.textContent).toContain("enregistrez d'abord");
    }
  });

  it("quantité d'un ingrédient modifiée : désactivés ; revenue à l'enregistré : actifs", () => {
    const qte = [...conteneur.querySelectorAll<HTMLInputElement>('input[type="number"]')].find((i) => i.value === "5")!;
    saisir(qte, "6");
    expect(boutonsPdf().every((b) => b.disabled)).toBe(true);
    saisir(qte, "5");
    expect(boutonsPdf().every((b) => !b.disabled)).toBe(true);
  });
});
