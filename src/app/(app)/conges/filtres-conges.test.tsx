// @vitest-environment happy-dom
//
// CONGÉS — LES FILTRES (refonte 2026-10-09) : recherche instantanée (sans bouton « Filtrer »), pastilles d'état
// et de type avec compteurs, période, regroupement — tout dans l'adresse.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const R = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: R.replace, push: vi.fn() }), useSearchParams: () => null, usePathname: () => "/conges" }));

import { FiltresConges } from "./filtres-conges";
import type { ParamsConges } from "@/lib/conges-liste";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ETATS = [
  { cle: "tous", n: 80 }, { cle: "EN_ATTENTE", n: 10 }, { cle: "en-cours", n: 3 }, { cle: "a-venir", n: 3 }, { cle: "APPROUVE", n: 64 }, { cle: "REFUSE", n: 6 },
] as const;
const TYPES = [{ nom: "Congé annuel", n: 15 }, { nom: "Congé maladie", n: 16 }];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(params: ParamsConges = {}, extra: Partial<Parameters<typeof FiltresConges>[0]> = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(FiltresConges, { params, etats: [...ETATS], etatActif: "tous", types: TYPES, actif: false, regroupement: "etat", ...extra })));
}
beforeEach(() => { vi.useFakeTimers(); R.replace.mockClear(); });
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  vi.useRealTimers();
});

const recherche = () => conteneur.querySelector<HTMLInputElement>('input[type="search"]')!;
function taper(el: HTMLInputElement, texte: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, texte);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const pastilles = (groupe: "etat" | "type") => [...conteneur.querySelectorAll<HTMLAnchorElement>(`[data-pastilles="${groupe}"] a`)];

describe("recherche instantanée", () => {
  it("pas de bouton « Filtrer » ; l'adresse suit la frappe après une courte pause, une seule fois", () => {
    monter();
    expect([...conteneur.querySelectorAll("button")].some((b) => /Filtrer/.test(b.textContent ?? ""))).toBe(false);
    taper(recherche(), "r"); taper(recherche(), "ra"); taper(recherche(), "rac");
    expect(R.replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(R.replace).toHaveBeenCalledTimes(1);
    expect(R.replace).toHaveBeenCalledWith("/conges?q=rac", { scroll: false });
  });

  it("garde les autres filtres et la taille de page, mais repart à la page 1", () => {
    monter({ statut: "APPROUVE", type: "Congé annuel", page: "3", par: "100", mois: "2026-10" });
    taper(recherche(), "lunda");
    act(() => { vi.advanceTimersByTime(300); });
    const url = new URL(R.replace.mock.calls[0][0], "http://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({ statut: "APPROUVE", type: "Congé annuel", par: "100", mois: "2026-10", q: "lunda" });
  });

  it("vider le champ retire `q` de l'adresse ; Entrée n'attend pas la pause", () => {
    monter({ q: "lunda" });
    expect(recherche().value).toBe("lunda");
    taper(recherche(), "");
    act(() => { vi.advanceTimersByTime(300); });
    expect(R.replace).toHaveBeenCalledWith("/conges", { scroll: false });
    R.replace.mockClear();
    taper(recherche(), "kab");
    act(() => { conteneur.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(R.replace).toHaveBeenCalledWith("/conges?q=kab", { scroll: false });
  });

  it("« Réinitialiser » vide aussi le champ", () => {
    monter({ q: "lunda", statut: "REFUSE" }, { actif: true });
    expect(recherche().value).toBe("lunda");
    act(() => racine.render(h(FiltresConges, { params: {}, etats: [...ETATS], etatActif: "tous", types: TYPES, actif: false, regroupement: "etat" })));
    expect(recherche().value).toBe("");
  });
});

describe("pastilles d'état et de type", () => {
  it("les anciennes cartes deviennent des pastilles chiffrées, cliquables, dans l'ordre", () => {
    monter();
    expect(pastilles("etat").map((a) => a.textContent?.replace(/\s+/g, " "))).toEqual([
      "Tous (80)", "En attente (10)", "En congé aujourd'hui (3)", "À venir (30 j) (3)", "Approuvés (64)", "Refusés (6)",
    ]);
    expect(pastilles("etat").map((a) => a.getAttribute("href"))).toEqual([
      "/conges", "/conges?statut=EN_ATTENTE", "/conges?statut=APPROUVE&quand=en-cours", "/conges?statut=APPROUVE&quand=a-venir", "/conges?statut=APPROUVE", "/conges?statut=REFUSE",
    ]);
  });

  it("la pastille choisie est marquée ; un clic sur une autre garde recherche et type, retire le reste", () => {
    monter({ statut: "APPROUVE", quand: "en-cours", q: "ra", type: "Congé annuel", page: "2" }, { etatActif: "en-cours", actif: true });
    expect(pastilles("etat").filter((a) => a.getAttribute("aria-current") === "true").map((a) => a.textContent)).toEqual(["En congé aujourd'hui (3)"]);
    const enAttente = pastilles("etat")[1].getAttribute("href")!;
    expect(Object.fromEntries(new URL(enAttente, "http://x").searchParams)).toEqual({ statut: "EN_ATTENTE", q: "ra", type: "Congé annuel" });
    expect(Object.fromEntries(new URL(pastilles("etat")[0].getAttribute("href")!, "http://x").searchParams)).toEqual({ q: "ra", type: "Congé annuel" }); // « Tous » : plus d'état
  });

  it("types : « Tous types » + un compteur par type ; le type choisi est marqué", () => {
    monter({ type: "Congé maladie" });
    expect(pastilles("type").map((a) => a.textContent?.replace(/\s+/g, " "))).toEqual(["Tous types", "Congé annuel (15)", "Congé maladie (16)"]);
    expect(pastilles("type").filter((a) => a.getAttribute("aria-current") === "true").map((a) => a.textContent)).toEqual(["Congé maladie (16)"]);
    expect(pastilles("type")[0].getAttribute("href")).toBe("/conges");
    expect(pastilles("type")[1].getAttribute("href")).toBe("/conges?type=Cong%C3%A9+annuel");
  });
});

describe("période, regroupement, réinitialisation", () => {
  it("un mois remplace une plage ; une plage remplace un mois", () => {
    monter({ du: "2026-10-01", au: "2026-10-31" });
    const mois = conteneur.querySelector<HTMLInputElement>('input[type="month"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(mois, "2026-11");
    act(() => { mois.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(R.replace).toHaveBeenLastCalledWith("/conges?mois=2026-11", { scroll: false });
    act(() => racine.unmount()); conteneur.remove();
    monter({ mois: "2026-10" });
    const du = conteneur.querySelector<HTMLInputElement>('input[aria-label="Période : du"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(du, "2026-10-05");
    act(() => { du.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(R.replace).toHaveBeenLastCalledWith("/conges?du=2026-10-05", { scroll: false });
  });

  it("regroupement : « Par état » (défaut) / « Par mois » ; la page repart à 1", () => {
    monter({ statut: "APPROUVE", page: "2" });
    const liens = [...conteneur.querySelectorAll<HTMLAnchorElement>('[aria-label="Regroupement"] a')];
    expect(liens.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Par état", "/conges?statut=APPROUVE"], ["Par mois", "/conges?statut=APPROUVE&groupe=mois"]]);
    expect(liens[0].getAttribute("aria-current")).toBe("true");
  });

  it("« Réinitialiser » n'apparaît que si un filtre est actif, et garde la taille de page", () => {
    monter();
    expect([...conteneur.querySelectorAll("a")].some((a) => a.textContent === "Réinitialiser")).toBe(false);
    act(() => racine.unmount()); conteneur.remove();
    monter({ statut: "REFUSE", par: "100" }, { actif: true, etatActif: "REFUSE" });
    expect([...conteneur.querySelectorAll("a")].find((a) => a.textContent === "Réinitialiser")?.getAttribute("href")).toBe("/conges?par=100");
  });

  it("téléphone : période et regroupement sont repliés derrière un bouton, ouverts d'office quand ils servent", () => {
    monter();
    const bouton = [...conteneur.querySelectorAll("button")].find((b) => /Période et regroupement/.test(b.textContent ?? ""))!;
    expect(bouton.getAttribute("aria-expanded")).toBe("false");
    expect(bouton.className).toMatch(/\bsm:hidden\b/);
    act(() => bouton.click());
    expect(bouton.getAttribute("aria-expanded")).toBe("true");
    act(() => racine.unmount()); conteneur.remove();
    monter({ mois: "2026-10" });
    expect([...conteneur.querySelectorAll("button")].find((b) => /Période et regroupement/.test(b.textContent ?? ""))!.getAttribute("aria-expanded")).toBe("true");
  });
});
