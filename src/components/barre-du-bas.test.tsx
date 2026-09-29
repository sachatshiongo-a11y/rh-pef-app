// @vitest-environment happy-dom
//
// La barre de navigation du bas, commune à TOUS les espaces (salarié, RH, Stock, Exploitation —
// 2026-09-29) : quatre écrans + « Menu ». On la monte pour de vrai (createRoot) afin de cliquer
// sur « Menu » comme sur un téléphone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BarreDuBas } from "./barre-du-bas";
import type { EntreeBarre } from "@/lib/navigation-espaces";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTREES: EntreeBarre[] = [
  { href: "/accueil", icone: "accueil", court: "Accueil" },
  { href: "/presences", icone: "presence", court: "Présences" },
  { href: "/planning", icone: "calendrier", court: "Planning" },
  { href: "/a-valider", icone: "valider", court: "À valider", badge: 7 },
];

let conteneur: HTMLDivElement;
let racine: Root;
const onMenu = vi.fn();

function monter(props: Partial<React.ComponentProps<typeof BarreDuBas>> = {}) {
  act(() =>
    racine.render(
      createElement(BarreDuBas, {
        entrees: ENTREES,
        estActif: (href: string) => href === "/planning",
        menuOuvert: false,
        onMenu,
        menuId: "menu-rh",
        ...props,
      }),
    ),
  );
  return conteneur.querySelector("nav")!;
}

beforeEach(() => {
  onMenu.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe("BarreDuBas", () => {
  it("affiche les quatre entrées dans l'ordre, puis le bouton Menu", () => {
    const nav = monter();
    const liens = [...nav.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent]);
    expect(liens).toEqual([
      ["/accueil", "Accueil"],
      ["/presences", "Présences"],
      ["/planning", "Planning"],
      ["/a-valider", "7À valider (7)"],
    ]);
    const boutons = nav.querySelectorAll("button");
    expect(boutons).toHaveLength(1);
    expect(boutons[0].textContent).toBe("Menu");
    // Une colonne par entrée + Menu, qui ne s'élargit jamais pour un libellé (375 px).
    expect(nav.querySelector("ul")!.getAttribute("style")).toContain("repeat(5, minmax(0, 1fr))");
  });

  it("marque l'entrée active (aria-current) et elle seule", () => {
    const nav = monter();
    const actifs = [...nav.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"));
    expect(actifs).toEqual(["/planning"]);
    expect(nav.querySelector('a[href="/planning"]')!.className).toContain("text-primary");
    expect(nav.querySelector('a[href="/accueil"]')!.className).toContain("text-muted-foreground");
  });

  it("porte le badge sur l'entrée concernée, jamais un zéro", () => {
    const nav = monter({ entrees: ENTREES.map((e) => (e.href === "/accueil" ? { ...e, badge: 0 } : e)) });
    const badges = [...nav.querySelectorAll("[data-badge]")].map((b) => [b.closest("a")!.getAttribute("href"), b.textContent]);
    expect(badges).toEqual([["/a-valider", "7"]]);
    const gros = monter({ entrees: [{ ...ENTREES[0], badge: 250 }] });
    expect(gros.querySelector("[data-badge]")!.textContent).toBe("99+");
  });

  it("« Menu » ouvre le tiroir de l'espace : il appelle onMenu et désigne le tiroir", () => {
    const nav = monter();
    const menu = nav.querySelector("button")!;
    expect(menu.getAttribute("aria-controls")).toBe("menu-rh");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    act(() => menu.click());
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(monter({ menuOuvert: true }).querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("fixée en bas, sous lg seulement, fond plein sans flou, marges de sécurité, cibles de 44 px et plus", () => {
    const nav = monter();
    const c = nav.className;
    for (const cl of ["fixed", "bottom-0", "lg:hidden", "bg-background", "pb-[env(safe-area-inset-bottom)]"]) expect(c.split(" "), cl).toContain(cl);
    expect(c).not.toMatch(/backdrop|\/\d+\b/); // ni flou, ni fond translucide (décroche en PWA iOS)
    // h-16 = 64 px de haut pour chaque lien et pour « Menu ».
    for (const el of nav.querySelectorAll("a, button")) expect(el.className.split(" ")).toContain("h-16");
  });
});
