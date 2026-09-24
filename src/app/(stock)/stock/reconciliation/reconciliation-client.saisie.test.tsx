// @vitest-environment happy-dom
//
// Inventaire (comptage physique) : la recherche MASQUE les lignes au lieu de les démonter.
// Avant le 2026-09-24, un comptage tapé puis écarté par la recherche était perdu (ligne démontée,
// état remis à vide au retour) et ne partait pas avec le formulaire.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({ appliquerComptage: vi.fn(async () => ({})) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import { ReconciliationForm } from "./reconciliation-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a1", code: "1", designation: "Tomate", categorie: "Légumes", theorique: 10 },
  { id: "a2", code: "2", designation: "Oignon", categorie: "Légumes", theorique: 5 },
  { id: "a3", code: "3", designation: "Farine", categorie: "Épicerie", theorique: 20 },
];

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(ReconciliationForm, { articles: ARTICLES })));
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
const physique = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Quantité physique — ${nom}"]`)!;
const recherche = () => conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!;

describe("Inventaire — saisie des comptages", () => {
  it("un comptage tapé survit à la recherche et part avec le formulaire", async () => {
    const t = physique("Tomate");
    act(() => t.focus());
    taper(t, "9,5");
    await act(async () => t.blur());
    taper(recherche(), "farine");
    expect(t.closest("tr")!.hidden).toBe(true); // masquée, pas démontée
    taper(recherche(), "");
    expect(physique("Tomate").value).toBe("9,5");
    const fd = new FormData(conteneur.querySelector("form")!);
    expect(fd.getAll("recon_articleId")).toEqual(["a1", "a2", "a3"]);
    expect(fd.getAll("recon_physique")).toEqual(["9,5", "", ""]);
  });

  it("Entrée descend à l'article VISIBLE suivant et n'envoie jamais le formulaire", async () => {
    taper(recherche(), "o"); // Tomate, Oignon (pas Farine)
    const t = physique("Tomate");
    act(() => t.focus());
    let ev!: KeyboardEvent;
    await act(async () => {
      ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      t.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(physique("Oignon"));
  });

  it("l'écart s'affiche à la validation de la case", async () => {
    const o = physique("Oignon");
    act(() => o.focus());
    taper(o, "4");
    await act(async () => o.blur());
    expect(o.closest("tr")!.textContent).toContain("-1");
  });
});
