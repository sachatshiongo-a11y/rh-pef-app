// @vitest-environment happy-dom
//
// Effectifs requis (planning) : appels serveur par case. Mesuré AVANT le 2026-09-24 avec ce même
// scénario : taper « 12 » = 2 appels à definirBesoin (un par frappe), chacun suivi d'un
// revalidatePath("/planning") — toute la page planning recalculée à chaque chiffre.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const appels = vi.hoisted(() => ({ definirBesoin: vi.fn(async () => {}) }));
vi.mock("./actions", () => appels);

import { BesoinsManager } from "./besoins-manager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  appels.definirBesoin.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(BesoinsManager, {
    shifts: [{ id: "s1", nom: "Midi" }],
    postes: ["Chef", "Commis"],
    besoins: [{ shiftId: "s1", poste: "Chef", jourSemaine: 1, nombreRequis: 2 }],
  })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Effectifs requis — appels serveur", () => {
  it("taper « 12 » puis quitter la case : 1 seul appel, à la sortie", async () => {
    const lundiChef = conteneur.querySelectorAll<HTMLInputElement>("tbody input")[0];
    act(() => lundiChef.focus());
    taper(lundiChef, "1");
    taper(lundiChef, "12");
    expect(appels.definirBesoin).toHaveBeenCalledTimes(0);
    await act(async () => lundiChef.blur());
    expect(appels.definirBesoin).toHaveBeenCalledTimes(1);
    expect(appels.definirBesoin).toHaveBeenCalledWith("s1", "Chef", 1, 12);
  });

  it("nombre de personnes : entier positif seulement", async () => {
    const c = conteneur.querySelectorAll<HTMLInputElement>("tbody input")[1];
    act(() => c.focus());
    taper(c, "1,5");
    await act(async () => c.blur());
    expect(appels.definirBesoin).not.toHaveBeenCalled();
    expect(c.getAttribute("aria-invalid")).toBe("true");
  });
});
