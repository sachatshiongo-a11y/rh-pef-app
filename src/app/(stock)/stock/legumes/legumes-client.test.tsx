// @vitest-environment happy-dom
//
// Achat de légumes frais : la grille (en <div>) est raccordée à la navigation commune des tableurs.
// Entrée descend à la MÊME colonne de la ligne suivante, ajoute une ligne sur la dernière (comme
// « + Ligne »), et n'envoie jamais le formulaire. Défaut relevé le 2026-09-30 : sans racine
// `data-tableur`, la case partagée ne trouvait pas sa grille et Entrée restait sur place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { creer } = vi.hoisted(() => ({ creer: vi.fn(async () => undefined) }));
vi.mock("./actions", () => ({ creerAchatsLegumes: creer, supprimerAchatLegume: vi.fn() }));

import { AchatLegumesForm } from "./legumes-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  creer.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(AchatLegumesForm, { taux: 2800, estDirection: true })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const cas = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="${nom}"]`)!;
const active = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label");
const nbLignes = () => conteneur.querySelectorAll('input[aria-label^="Quantité, ligne"]').length;

async function entree(el: HTMLElement) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });
  return ev;
}

describe("Achat de légumes frais — navigation au clavier", () => {
  it("la grille est une racine de tableur", () => {
    expect(conteneur.querySelector("[data-tableur]")).not.toBeNull();
    expect(conteneur.querySelector("[data-tableur]")?.contains(cas("Quantité, ligne 1"))).toBe(true);
  });

  it("Entrée descend à la MÊME colonne de la ligne suivante, sans envoyer", async () => {
    act(() => cas("Quantité, ligne 1").focus());
    const ev = await entree(cas("Quantité, ligne 1"));
    expect(ev.defaultPrevented).toBe(true);
    expect(active()).toBe("Quantité, ligne 2");
    act(() => cas("Montant CDF, ligne 2").focus());
    await entree(cas("Montant CDF, ligne 2"));
    expect(active()).toBe("Montant CDF, ligne 3");
    expect(creer).not.toHaveBeenCalled();
  });

  it("Entrée sur la DERNIÈRE ligne ajoute une ligne et s'y place, dans la même colonne", async () => {
    expect(nbLignes()).toBe(3);
    act(() => cas("Montant CDF, ligne 3").focus());
    await entree(cas("Montant CDF, ligne 3"));
    expect(nbLignes()).toBe(4);
    expect(active()).toBe("Montant CDF, ligne 4");
    expect(creer).not.toHaveBeenCalled();
  });
});
