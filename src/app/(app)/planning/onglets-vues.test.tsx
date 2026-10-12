// @vitest-environment happy-dom
//
// Les vues du planning (Semaine / Mois / Modèle hebdo / Écart) : le segment commun des onglets de vue,
// qui remplace la liste déroulante (plan d'ergonomie H2). L'onglet actif suit `?vue=` ; les adresses
// conservent la période affichée ; `?debut=` (semaine) et `?vue=mois|modele|ecart` restent valables.
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OngletsVues } from "./onglets-vues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(vue: string) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(OngletsVues, { vue, semaineHref: "/planning?debut=2026-10-05", moisHref: "/planning?vue=mois&mois=10&annee=2026", ecartHref: "/planning?vue=ecart&mois=10&annee=2026" })));
  return [...conteneur.querySelectorAll("nav a")] as HTMLAnchorElement[];
}

describe("vues du planning en onglets", () => {
  it("quatre onglets dans le segment commun, plus de liste déroulante", () => {
    const onglets = monter("semaine");
    expect(onglets.map((a) => a.textContent)).toEqual(["Semaine", "Mois", "Modèle hebdo", "Écart prévu/réalisé"]);
    expect(conteneur.querySelector("select")).toBeNull();
    expect(conteneur.querySelector("nav")!.parentElement!.className).toContain("overflow-x-auto");
  });

  it("le bon onglet est actif selon la vue de l'adresse", () => {
    for (const [vue, rang] of [["semaine", 0], ["mois", 1], ["modele", 2], ["ecart", 3]] as const) {
      const onglets = monter(vue);
      expect(onglets.map((a) => a.getAttribute("aria-current")), vue).toEqual([0, 1, 2, 3].map((i) => (i === rang ? "page" : null)));
      act(() => racine.unmount()); conteneur.remove();
    }
    racine = createRoot(document.createElement("div")); conteneur = document.createElement("div"); // pour l'afterEach
  });

  it("les adresses gardent la période affichée et les anciens paramètres", () => {
    const onglets = monter("mois");
    expect(onglets.map((a) => a.getAttribute("href"))).toEqual([
      "/planning?debut=2026-10-05",
      "/planning?vue=mois&mois=10&annee=2026",
      "/planning?vue=modele",
      "/planning?vue=ecart&mois=10&annee=2026",
    ]);
  });
});
