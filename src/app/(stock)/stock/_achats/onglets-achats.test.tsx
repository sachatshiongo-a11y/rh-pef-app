// @vitest-environment happy-dom
//
// Les trois vues d'« Achats & mouvements » (Mouvements · Liste d'achat · Légumes frais) : le segment
// commun des onglets de vue (plan d'ergonomie H2) ; l'onglet actif suit l'adresse de la page, sous-chemins compris.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const chemin = vi.hoisted(() => ({ valeur: "/stock/mouvements" }));
vi.mock("next/navigation", () => ({ usePathname: () => chemin.valeur }));
const { OngletsAchats } = await import("./onglets-achats");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(pathname: string) {
  chemin.valeur = pathname;
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(OngletsAchats)));
  return [...conteneur.querySelectorAll("nav a")] as HTMLAnchorElement[];
}

describe("Achats & mouvements en onglets de vue", () => {
  it("trois onglets, mêmes routes qu'avant, dans le segment commun (pas de pastilles)", () => {
    const onglets = monter("/stock/mouvements");
    expect(onglets.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Mouvements", "/stock/mouvements"], ["Liste d'achat", "/stock/entree"], ["Légumes frais", "/stock/legumes"],
    ]);
    expect(onglets[0]!.className).not.toContain("rounded-full");
    expect(conteneur.querySelector("nav")!.parentElement!.className).toContain("overflow-x-auto");
  });

  it("l'onglet actif suit la page, sous-chemins compris", () => {
    for (const [pathname, rang] of [["/stock/mouvements", 0], ["/stock/entree", 1], ["/stock/legumes", 2], ["/stock/legumes/fiche", 2]] as const) {
      const onglets = monter(pathname);
      expect(onglets.map((a) => a.getAttribute("aria-current")), pathname).toEqual([0, 1, 2].map((i) => (i === rang ? "page" : null)));
      act(() => racine.unmount()); conteneur.remove();
    }
    conteneur = document.createElement("div"); racine = createRoot(conteneur);
  });
});
