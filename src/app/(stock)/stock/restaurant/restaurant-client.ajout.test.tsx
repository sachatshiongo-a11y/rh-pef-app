// @vitest-environment happy-dom
//
// « + Ajouter un article » du stock restaurant : un refus du serveur reste affiché et la saisie est gardée
// (avant : le panneau se fermait et la saisie disparaissait sans un mot — audit du 10/10/2026, ergonomie 1).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({ creer: vi.fn<(fd: FormData) => Promise<unknown>>(async () => undefined) }));
vi.mock("./actions", () => ({
  majComptage: vi.fn(), changerActivationArticlesResto: vi.fn(), modifierArticleResto: vi.fn(), creerArticleResto: m.creer,
  supprimerArticleResto: vi.fn(), ajouterLiensResto: vi.fn(), retirerLiensResto: vi.fn(),
}));

const { RestaurantGrille } = await import("./restaurant-client");
const { JourMobileProvider } = await import("@/components/jour-mobile");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  m.creer.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(
    <JourMobileProvider defaultIdx={0}>
      <RestaurantGrille espace="CUISINE" jours={[{ iso: "2026-10-12", label: "Lun", num: "12 oct." }]} lignes={[]} categories={[]} estDirection={true} catalogue={[]} />
    </JourMobileProvider>,
  ));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const formulaire = () => conteneur.querySelector<HTMLFormElement>("form");
async function ouvrirEtSaisir() {
  await act(async () => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Ajouter un article"))!.click());
  const champ = formulaire()!.querySelector<HTMLInputElement>('input[name="designation"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ, "Farine T55");
  act(() => { champ.dispatchEvent(new Event("input", { bubbles: true })); });
}
const envoyer = async () => { await act(async () => { formulaire()!.requestSubmit(); }); };

describe("Stock restaurant — ajout d'un article", () => {
  it("refus du serveur : message affiché, panneau ouvert, désignation gardée", async () => {
    m.creer.mockResolvedValueOnce({ erreur: "Cet article existe déjà dans l'espace Cuisine." });
    await ouvrirEtSaisir();
    await envoyer();
    expect(conteneur.querySelector('[role="alert"], p.text-destructive')?.textContent).toContain("existe déjà");
    expect(formulaire()).not.toBeNull();
    expect(formulaire()!.querySelector<HTMLInputElement>('input[name="designation"]')!.value).toBe("Farine T55");
  });

  it("accepté : le panneau se ferme", async () => {
    await ouvrirEtSaisir();
    await envoyer();
    expect(m.creer).toHaveBeenCalledTimes(1);
    expect(formulaire()).toBeNull();
  });
});
