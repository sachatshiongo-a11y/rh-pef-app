// @vitest-environment happy-dom
//
// Sens de départ du formulaire de mouvement manuel (plan d'ergonomie, V7) : le geste du jour d'un compte Stock est la
// SORTIE (le formulaire s'ouvre réglé dessus) ; la Direction, elle, reste sur ENTRÉE. Le sens est lu dans ce que le
// serveur recevrait (le champ caché `type`) et dans le bouton de validation, pas seulement dans la couleur.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({
  mouvementManuel: vi.fn(async () => ({ demande: false, message: "ok" })), supprimerMouvement: vi.fn(async () => undefined), supprimerMouvementsEnLot: vi.fn(async () => undefined),
  requalifierSorties: vi.fn(async () => ({ n: 0 })), changerDateSorties: vi.fn(async () => ({ n: 0, deja: 0, date: "2026-10-12" })),
}));

const { MouvementForm } = await import("./mouvements-client");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [{ id: "riz", designation: "Riz", unite: "Sac", domaine: "NOURRITURE", quantite: 4 }];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte)) as HTMLButtonElement | undefined;
function ouvrir(props: { estDirection?: boolean } = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(MouvementForm, { articles: ARTICLES, ...props })));
  act(() => bouton("Mouvement manuel")!.click());
}
const sens = () => conteneur.querySelector<HTMLInputElement>('input[name="type"]')?.value;

describe("formulaire de mouvement — sens de départ", () => {
  it("un compte Stock : réglé sur SORTIE, bouton « Valider la sortie »", () => {
    ouvrir({ estDirection: false });
    expect(sens()).toBe("SORTIE");
    expect(bouton("Valider la sortie")).toBeTruthy();
    expect(bouton("Valider l'entrée")).toBeUndefined();
  });

  it("la Direction : réglée sur ENTRÉE, bouton « Valider l'entrée »", () => {
    ouvrir({ estDirection: true });
    expect(sens()).toBe("ENTREE");
    expect(bouton("Valider l'entrée")).toBeTruthy();
  });

  it("sans indication de rôle, c'est le cas du compte Stock : SORTIE", () => {
    ouvrir();
    expect(sens()).toBe("SORTIE");
  });

  it("le sens reste modifiable : un compte Stock bascule sur Entrée, la Direction sur Sortie", () => {
    ouvrir({ estDirection: false });
    act(() => bouton("Entrée")!.click());
    expect(sens()).toBe("ENTREE");
    act(() => racine.unmount()); conteneur.remove();
    ouvrir({ estDirection: true });
    act(() => bouton("Sortie")!.click());
    expect(sens()).toBe("SORTIE");
  });
});
