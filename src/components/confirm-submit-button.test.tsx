// @vitest-environment happy-dom
//
// ConfirmSubmitButton : refuser la confirmation n'envoie PAS le formulaire (geste définitif évité) ; un bouton-icône
// (✕) garde son nom accessible (title / aria-label).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmSubmitButton } from "./confirm-submit-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.unstubAllGlobals(); });
function monter() {
  const envoi = vi.fn((e: Event) => e.preventDefault());
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h("form", { onSubmit: envoi as never }, h(ConfirmSubmitButton, { message: "Supprimer la prime ?", title: "Supprimer", "aria-label": "Supprimer la prime Transport", children: "✕" }))));
  return envoi;
}

describe("ConfirmSubmitButton", () => {
  it("confirmation refusée : le formulaire n'est pas envoyé", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const envoi = monter();
    await act(async () => conteneur.querySelector("button")!.click());
    expect(envoi).not.toHaveBeenCalled();
  });
  it("confirmation acceptée : le formulaire part", async () => {
    const confirmer = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmer);
    const envoi = monter();
    await act(async () => conteneur.querySelector("button")!.click());
    expect(confirmer).toHaveBeenCalledWith("Supprimer la prime ?");
    expect(envoi).toHaveBeenCalledTimes(1);
  });
  it("le bouton-icône garde son nom accessible", () => {
    monter();
    const b = conteneur.querySelector("button")!;
    expect(b.getAttribute("aria-label")).toBe("Supprimer la prime Transport");
    expect(b.getAttribute("title")).toBe("Supprimer");
  });
});
