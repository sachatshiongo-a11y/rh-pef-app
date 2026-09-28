// @vitest-environment happy-dom
//
// Saisie d'une sortie « Livraison restaurant » : si l'article n'alimentera pas le stock du restaurant
// (non rattaché, rattaché à plusieurs articles, unité incompatible), un avertissement NON BLOQUANT
// s'affiche avant la validation. Une perte n'avertit de rien.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({
  mouvementManuel: vi.fn(async () => undefined), supprimerMouvement: vi.fn(async () => undefined), supprimerMouvementsEnLot: vi.fn(async () => undefined),
}));

const { MouvementForm, AVERTISSEMENT_LIVRAISON } = await import("./mouvements-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [{ id: "farine", designation: "Farine" }, { id: "sel", designation: "Sel" }, { id: "citron", designation: "Citron" }, { id: "vin", designation: "Vin" }, { id: "biere", designation: "Bière" }];
// Conseils calculés par le serveur (`conseilLivraison`) : un par article en défaut, aucun pour la farine.
const CONSEILS = {
  sel: { texte: "non rattaché : rattachez l'article", href: "/stock/restaurant" },
  citron: { texte: "à répartir : plusieurs articles du restaurant rattachés", href: "/stock/restaurant?espace=CUISINE" },
  vin: { texte: "unités incompatibles : corrigez l'unité du restaurant ou le rattachement", href: "/stock/restaurant?espace=BAR" },
  biere: { texte: "unité du restaurant non renseignée : renseignez-la dans Stock restaurant", href: "/stock/restaurant?espace=BAR" },
};

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(MouvementForm, { articles: ARTICLES, conseilsLivraison: CONSEILS })));
  act(() => bouton("Mouvement manuel").click());
  act(() => bouton("Sortie").click());
}
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;
function choisir(select: HTMLSelectElement, valeur: string) {
  act(() => {
    select.value = valeur;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const motif = () => conteneur.querySelector<HTMLSelectElement>('select[name="categorieSortie"]')!;
const ligne = (i: number) => conteneur.querySelectorAll<HTMLSelectElement>('select[name="articleId"]')[i]!;
const avertissement = () => conteneur.querySelector('[role="status"][data-avertissement="livraison"]');

describe("mouvements — avertissement « Livraison restaurant »", () => {
  it("article non rattaché : avertit, sans bloquer la validation", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "sel");
    expect(avertissement()?.textContent).toContain("Sel");
    expect(avertissement()?.textContent).toContain(AVERTISSEMENT_LIVRAISON);
    expect(AVERTISSEMENT_LIVRAISON).toBe("cette livraison n'alimentera pas le stock du restaurant");
    const lien = avertissement()?.querySelector('a[href="/stock/restaurant"]');
    expect(lien?.textContent).toBe("non rattaché : rattachez l'article");
    expect(bouton("Valider la sortie").disabled).toBe(false);
  });

  it("chaque cas a son message et son lien : à répartir, unités incompatibles, unité du restaurant non renseignée", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "citron");
    choisir(ligne(1), "vin");
    choisir(ligne(2), "biere");
    const liens = [...avertissement()!.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(liens).toEqual([
      ["à répartir : plusieurs articles du restaurant rattachés", "/stock/restaurant?espace=CUISINE"],
      ["unités incompatibles : corrigez l'unité du restaurant ou le rattachement", "/stock/restaurant?espace=BAR"],
      ["unité du restaurant non renseignée : renseignez-la dans Stock restaurant", "/stock/restaurant?espace=BAR"],
    ]);
    expect(avertissement()!.textContent).toContain("« Citron »");
    expect(avertissement()!.textContent).toContain("« Bière »");
  });

  it("article bien rattaché, ou motif Perte : aucun avertissement", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "farine");
    expect(avertissement()).toBeNull();
    choisir(ligne(0), "sel");
    expect(avertissement()).not.toBeNull();
    choisir(motif(), "PERTE");
    expect(avertissement()).toBeNull();
  });
});
