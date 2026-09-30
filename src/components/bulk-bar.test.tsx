// @vitest-environment happy-dom
//
// La barre d'actions groupées, commune à toute l'application. Montée pour de vrai : elle se colle
// SOUS l'en-tête de la coquille sur téléphone (classe `colle-sous-entete`, cf. entete-mobile.ts) et
// non plus en haut de l'écran, où elle recouvrait l'en-tête.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BulkBar } from "./bulk-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
const onAll = vi.fn();

function monter(count: number, total: number) {
  act(() => racine.render(createElement(BulkBar, { count, total, onAll }, createElement("button", null, "Supprimer"))));
  return conteneur.firstElementChild as HTMLElement;
}

beforeEach(() => {
  onAll.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe("BulkBar", () => {
  it("se colle sous l'en-tête de la coquille sur téléphone, sans `top-0` brut", () => {
    const barre = monter(2, 5);
    const classes = barre.className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("colle-sous-entete");
    expect(classes.some((c) => /(^|:)top-/.test(c)), "un haut recopié en dur").toBe(false);
  });

  it("reste sous l'en-tête (z-20 < 35) et sans flou (piège PWA iOS)", () => {
    const barre = monter(2, 5);
    expect(barre.className).toContain("z-20");
    expect(barre.className).not.toMatch(/backdrop-/);
  });

  it("n'affiche les actions qu'à la sélection ; « Tout sélectionner » appelle onAll", () => {
    expect(monter(0, 5).textContent).not.toContain("Supprimer");
    const barre = monter(2, 5);
    expect(barre.textContent).toContain("2 sélectionné(s)");
    expect(barre.textContent).toContain("Supprimer");
    const case_ = barre.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(case_.indeterminate).toBe(true);
    act(() => case_.click());
    expect(onAll).toHaveBeenCalledWith(true);
  });
});
