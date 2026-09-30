// @vitest-environment happy-dom
//
// Verrou du défilement de la page (tiroir des espaces, modales plein écran). Sur iOS, `overflow:
// hidden` sur <body> ne suffit pas : le verrou fige le body en `position: fixed` avec `top: -scrollY`
// puis rend EXACTEMENT la position à la fermeture. Ce que ce test ne voit pas : le geste réel au doigt
// sur un iPhone (vérifié à la main dans un navigateur, pas sur l'appareil).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLockBodyScroll, verrouillerPage } from "./use-lock-body-scroll";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const corps = () => document.body.style;
let defile: ReturnType<typeof vi.fn>;
let conteneur: HTMLDivElement;
let racine: Root;

function Verrou({ actif }: { actif: boolean }) {
  useLockBodyScroll(actif);
  return null;
}
const monter = (actif: boolean) => act(() => racine.render(h(Verrou, { actif })));

beforeEach(() => {
  window.history.replaceState({}, "", "/page-a");
  Object.defineProperty(window, "scrollY", { value: 1234, configurable: true });
  defile = vi.fn();
  window.scrollTo = defile as unknown as typeof window.scrollTo;
  document.body.removeAttribute("style");
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  document.body.removeAttribute("style");
});

describe("verrou de la page", () => {
  it("fige le body en position fixe à -scrollY, puis restaure la position exacte à la fermeture", () => {
    monter(true);
    expect(corps().position).toBe("fixed");
    expect(corps().top).toBe("-1234px");
    expect(corps().overflow).toBe("hidden");
    expect(corps().width).toBe("100%");
    monter(false);
    expect(corps().position).toBe("");
    expect(corps().top).toBe("");
    expect(corps().overflow).toBe("");
    expect(defile).toHaveBeenCalledTimes(1);
    expect(defile).toHaveBeenCalledWith({ top: 1234, left: 0, behavior: "instant" });
  });

  it("rend les styles que le body portait déjà, pas des chaînes vides", () => {
    document.body.style.overflow = "auto";
    document.body.style.width = "50%";
    monter(true);
    monter(false);
    expect(corps().overflow).toBe("auto");
    expect(corps().width).toBe("50%");
  });

  it("se déverrouille au démontage, sans repasser par actif=false", () => {
    monter(true);
    expect(corps().position).toBe("fixed");
    act(() => racine.unmount());
    expect(corps().position).toBe("");
    expect(defile).toHaveBeenCalledWith({ top: 1234, left: 0, behavior: "instant" });
    racine = createRoot(conteneur); // pour l'afterEach
  });

  it("à la navigation, relâche la page SANS rejouer l'ancienne position (la nouvelle page s'ouvre en haut)", () => {
    monter(true);
    window.history.pushState({}, "", "/page-b"); // un lien du tiroir, la touche retour
    monter(false);
    expect(corps().position).toBe("");
    expect(corps().top).toBe("");
    expect(defile).not.toHaveBeenCalled();
  });

  it("verrou compté : la page reste figée tant qu'un appelant a encore besoin d'elle, position d'AVANT le premier", () => {
    const relacher1 = verrouillerPage();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true }); // le body figé annonce 0
    const relacher2 = verrouillerPage();
    expect(corps().top).toBe("-1234px");
    relacher1();
    expect(corps().position).toBe("fixed");
    relacher2();
    expect(corps().position).toBe("");
    expect(defile).toHaveBeenCalledTimes(1);
    expect(defile).toHaveBeenCalledWith({ top: 1234, left: 0, behavior: "instant" });
  });

  it("relâcher deux fois le même verrou ne déverrouille pas celui d'un autre", () => {
    const a = verrouillerPage();
    const b = verrouillerPage();
    a(); a();
    expect(corps().position).toBe("fixed");
    b();
    expect(corps().position).toBe("");
  });
});
