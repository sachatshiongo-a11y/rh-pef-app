// @vitest-environment happy-dom
//
// Inventaire (comptage) — pagination (2026-10-08). Le formulaire garde TOUTES les lignes montées : celles
// qui ne sont pas sur la page sont MASQUÉES, pas démontées — une quantité tapée en page 1 part avec le
// comptage même si l'on termine en page 3.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({ appliquerComptage: vi.fn(async () => ({})) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import { ReconciliationForm } from "./reconciliation-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = Array.from({ length: 120 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return { id: `a${n}`, code: String(i + 1), designation: `Art ${n}`, categorie: i < 60 ? "Farines" : "Huiles", theorique: 10 };
});

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: { pageInit?: number; parInit?: 50 | 100 | "tout" } = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(ReconciliationForm, { articles: ARTICLES, ...props })));
}
beforeEach(() => { window.history.replaceState(null, "", "/stock/reconciliation"); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const physique = (nom: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Quantité physique — ${nom}"]`)!;
const affichees = () => [...conteneur.querySelectorAll<HTMLInputElement>('input[name="recon_physique"]')].filter((i) => !i.closest("[hidden]")).length;
const compteur = () => conteneur.querySelector("[data-pagination-compteur]")?.textContent ?? "";
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const bouton = (label: string) => conteneur.querySelector<HTMLButtonElement>(`nav[data-pagination] button[aria-label="${label}"]`)!;

describe("Inventaire (comptage) paginé", () => {
  it("page 1 : 50 lignes affichées sur 120, compteur et URL", () => {
    monter();
    expect(affichees()).toBe(50);
    expect(compteur()).toContain("1–50 sur 120");
  });

  it("page 2 puis 100 / Tout, la taille et la page vont dans l'URL", () => {
    monter();
    clic(bouton("Page suivante"));
    expect(compteur()).toContain("51–100 sur 120");
    expect(physique("Art 051").closest("tr")!.hidden).toBe(false);
    expect(physique("Art 050").closest("tr")!.hidden).toBe(true);
    expect(window.location.search).toBe("?page=2");
    clic(bouton("Afficher tout"));
    expect(affichees()).toBe(120);
    expect(window.location.search).toBe("?par=tout");
  });

  it("une quantité tapée en page 1 survit au changement de page et part avec le formulaire", async () => {
    monter();
    const t = physique("Art 001");
    act(() => t.focus());
    taper(t, "9,5");
    await act(async () => t.blur());
    clic(bouton("Page suivante"));
    clic(bouton("Page suivante"));
    expect(t.closest("tr")!.hidden).toBe(true); // masquée, pas démontée
    const fd = new FormData(conteneur.querySelector("form")!);
    expect(fd.getAll("recon_articleId")).toHaveLength(120); // les 120 lignes partent, pas seulement la page
    expect(fd.getAll("recon_physique")[0]).toBe("9,5");
    clic(bouton("Page précédente")); clic(bouton("Page précédente"));
    expect(physique("Art 001").value).toBe("9,5");
  });

  it("la recherche porte sur tout l'ensemble et ramène à la page 1", () => {
    monter({ pageInit: 3 });
    taper(conteneur.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')!, "Art 117");
    expect(affichees()).toBe(1);
    expect(physique("Art 117").closest("tr")!.hidden).toBe(false);
    expect(conteneur.textContent).toContain("1 / 120 article(s)");
  });

  it("démarre à la page de l'URL ; l'en-tête de catégorie est rappelé en tête de page", () => {
    monter({ pageInit: 2 }); // 51–100 : Farines (51–60) puis Huiles (61–100)
    const entetes = [...conteneur.querySelectorAll("tbody td[colspan='6']")].filter((td) => !td.closest("[hidden]")).map((td) => td.textContent);
    expect(entetes[0]).toMatch(/^Farines \(60\)/);
    expect(entetes[1]).toMatch(/^Huiles \(60\)/);
  });

  it("dit que les quantités de toutes les pages sont envoyées ensemble", () => {
    monter();
    expect(conteneur.querySelector("[data-pagination-note]")!.textContent).toContain("toutes les pages");
  });
});
