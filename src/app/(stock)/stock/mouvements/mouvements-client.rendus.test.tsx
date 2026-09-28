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

const ARTICLES = [{ id: "farine", designation: "Farine" }, { id: "sel", designation: "Sel" }, { id: "citron", designation: "Citron" }, { id: "vin", designation: "Vin" }];
const ETATS = { farine: "OK", sel: "NON_RATTACHE", citron: "A_REPARTIR", vin: "UNITE_INCOMPATIBLE" } as const;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(MouvementForm, { articles: ARTICLES, etatsLivraison: ETATS })));
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
    expect(AVERTISSEMENT_LIVRAISON).toBe("cette livraison n'alimentera pas le stock du restaurant : rattachez l'article");
    expect(avertissement()?.querySelector('a[href="/stock/restaurant"]')).not.toBeNull();
    expect(bouton("Valider la sortie").disabled).toBe(false);
  });

  it("plusieurs rattachements ou unité incompatible : avertit aussi, avec la raison", () => {
    monter();
    choisir(motif(), "LIVRAISON_RESTAURANT");
    choisir(ligne(0), "citron");
    choisir(ligne(1), "vin");
    const texte = avertissement()?.textContent ?? "";
    expect(texte).toContain("Citron");
    expect(texte).toContain("plusieurs articles du restaurant");
    expect(texte).toContain("Vin");
    expect(texte).toContain("unité incompatible");
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
