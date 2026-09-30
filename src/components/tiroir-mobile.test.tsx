// @vitest-environment happy-dom
//
// Tiroir latéral des espaces, commun aux quatre coquilles (2026-09-29, défilement en PWA iOS) :
// le tiroir est le seul conteneur qui défile, la page derrière est figée pendant l'ouverture et
// retrouve sa position, le voile ne défile pas et ferme, rien ne reste bloqué après la fermeture
// (navigation, retour, Échap, rotation, largeur ordinateur). Ce que ce test ne voit pas : le geste réel
// au doigt sur un iPhone ; le comportement a été mesuré dans un navigateur à 375 × 812.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ pathname: "/page-a" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { Tiroir, VoileTiroir, useTiroir } from "./tiroir-mobile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Demo() {
  const { ouvert, ouvrir, fermer } = useTiroir();
  return h("div", null,
    h(VoileTiroir, { ouvert, onFermer: fermer }),
    h(Tiroir, { id: "menu-demo", ouvert, className: "w-64" }, h("a", { href: "/x", onClick: fermer }, "Lien")),
    h("button", { id: "menu", onClick: ouvrir }, "Menu"));
}

let conteneur: HTMLDivElement;
let racine: Root;
let defile: ReturnType<typeof vi.fn>;
let large: { matches: boolean; ecouteurs: Set<() => void> };

const corps = () => document.body.style;
const voile = () => conteneur.querySelector<HTMLElement>("[data-voile-tiroir]");
const tiroir = () => document.getElementById("menu-demo")!;
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const ouvrir = () => clic(conteneur.querySelector("#menu")!);
const rendre = () => act(() => racine.render(h(Demo)));

beforeEach(() => {
  nav.pathname = "/page-a";
  window.history.replaceState({}, "", "/page-a");
  Object.defineProperty(window, "scrollY", { value: 800, configurable: true });
  defile = vi.fn();
  window.scrollTo = defile as unknown as typeof window.scrollTo;
  large = { matches: false, ecouteurs: new Set() };
  window.matchMedia = ((q: string) => ({
    get matches() { return large.matches; }, media: q,
    addEventListener: (_: string, f: () => void) => large.ecouteurs.add(f),
    removeEventListener: (_: string, f: () => void) => large.ecouteurs.delete(f),
  })) as unknown as typeof window.matchMedia;
  document.body.removeAttribute("style");
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  rendre();
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.removeAttribute("style"); });

describe("le panneau : seul conteneur qui défile, propre et sans flou", () => {
  it("défile seul, sans chaînage, en 100dvh avec les marges de sécurité", () => {
    const c = tiroir().className;
    expect(c).toContain("overflow-y-auto");
    expect(c).toContain("overscroll-contain");
    expect(c).toContain("max-lg:h-dvh");
    expect(c).toContain("env(safe-area-inset-top)");
    expect(c).toContain("env(safe-area-inset-bottom)");
    expect(c).toContain("env(safe-area-inset-left)");
    expect(c).toContain("w-64"); // la largeur propre à l'espace passe par className
  });

  it("est ouvert en permanence sur ordinateur (statique) et hors de l'écran, fermé, sur téléphone", () => {
    expect(tiroir().className).toContain("-translate-x-full");
    expect(tiroir().className).toContain("lg:translate-x-0");
    expect(tiroir().className).toContain("lg:static");
  });

  it("aucun flou d'arrière-plan sur un élément fixe (décroche en PWA iOS)", () => {
    ouvrir();
    for (const el of [tiroir(), voile()!]) expect(el.className).not.toMatch(/backdrop-|blur/);
  });
});

describe("ouverture : la page derrière est figée", () => {
  it("fermé : rien n'est verrouillé et il n'y a pas de voile", () => {
    expect(voile()).toBeNull();
    expect(corps().position).toBe("");
  });

  it("ouvert : body figé à -scrollY, voile présent, panneau à l'écran", () => {
    ouvrir();
    expect(corps().position).toBe("fixed");
    expect(corps().top).toBe("-800px");
    expect(tiroir().className).toContain("translate-x-0");
    expect(tiroir().className).not.toContain("-translate-x-full");
    expect(voile()).not.toBeNull();
  });

  it("le voile ne défile pas (touch-none, overscroll contenu) ; un appui dessus ferme et rend la position exacte", () => {
    ouvrir();
    expect(voile()!.className).toContain("touch-none");
    expect(voile()!.className).toContain("overscroll-contain");
    clic(voile()!);
    expect(voile()).toBeNull();
    expect(corps().position).toBe("");
    expect(corps().top).toBe("");
    expect(defile).toHaveBeenCalledWith({ top: 800, left: 0, behavior: "instant" });
  });

  it("un lien du tiroir ferme (le verrou est relâché avant la navigation)", () => {
    ouvrir();
    clic(tiroir().querySelector("a")!);
    expect(corps().position).toBe("");
    expect(voile()).toBeNull();
  });
});

describe("rien ne reste bloqué après la fermeture", () => {
  it("navigation : le chemin change → fermé, page relâchée, ancienne position PAS rejouée", () => {
    ouvrir();
    window.history.pushState({}, "", "/page-b");
    nav.pathname = "/page-b";
    rendre();
    expect(voile()).toBeNull();
    expect(tiroir().className).toContain("-translate-x-full");
    expect(corps().position).toBe("");
    expect(defile).not.toHaveBeenCalled();
  });

  it("touche retour (popstate) : fermé et relâché", () => {
    ouvrir();
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(voile()).toBeNull();
    expect(corps().position).toBe("");
  });

  it("touche Échap : fermé et relâché ; une autre touche ne fait rien", () => {
    ouvrir();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(corps().position).toBe("fixed");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(corps().position).toBe("");
  });

  it("rotation de l'appareil : fermé et relâché", () => {
    ouvrir();
    act(() => { window.dispatchEvent(new Event("orientationchange")); });
    expect(voile()).toBeNull();
    expect(corps().position).toBe("");
  });

  it("passage à la largeur ordinateur (rotation d'une tablette) : fermé et relâché, jamais une page bloquée", () => {
    ouvrir();
    act(() => { large.matches = true; large.ecouteurs.forEach((f) => f()); });
    expect(voile()).toBeNull();
    expect(corps().position).toBe("");
  });

  it("une largeur qui reste étroite ne ferme rien", () => {
    ouvrir();
    act(() => { large.matches = false; large.ecouteurs.forEach((f) => f()); });
    expect(corps().position).toBe("fixed");
  });

  it("démonté tiroir ouvert : la page est relâchée et les écouteurs retirés", () => {
    ouvrir();
    act(() => racine.unmount());
    expect(corps().position).toBe("");
    expect(large.ecouteurs.size).toBe(0);
    racine = createRoot(conteneur);
  });

  it("se rouvre normalement après une fermeture par navigation", () => {
    ouvrir();
    window.history.pushState({}, "", "/page-b");
    nav.pathname = "/page-b";
    rendre();
    ouvrir();
    expect(corps().position).toBe("fixed");
    expect(voile()).not.toBeNull();
  });
});
