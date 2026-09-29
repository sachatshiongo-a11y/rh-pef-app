// @vitest-environment happy-dom
//
// Grille « Ventes » (Conso. journalière) : forme du classeur (Cuisine puis Bar, par rubrique),
// case vide = « — » (pas de saisie) et 0 = 0, jour de période clôturée en lecture seule, et ce qui
// part au serveur (null pour une case vidée, jamais 0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LigneVente } from "@/lib/ventes-journalieres";

const m = vi.hoisted(() => ({
  saisirVente: vi.fn<(ligne: string, jour: string, q: number | null) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  rafraichirJournalier: vi.fn(async () => {}),
}));
vi.mock("./ventes-actions", () => ({ saisirVente: m.saisirVente }));
vi.mock("./actions", () => ({ rafraichirJournalier: m.rafraichirJournalier }));

import { VentesGrid, type JourVente } from "./ventes-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS: JourVente[] = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((iso, i) => ({ iso, label: `J${i}`, fige: iso === "2026-08-31" }));
const L = (cle: string, designation: string, rubrique: string, espace: "CUISINE" | "BAR", inactif = false): LigneVente => ({ cle, designation, rubrique, espace, inactif });
const LIGNES = [
  L("fiche:carbo", "Carbonara", "Pâtes classiques", "CUISINE"),
  L("fiche:bolo", "Bolognaise", "Pâtes classiques", "CUISINE", true),
  L("fiche:creme", "Crème brûlée", "Desserts", "CUISINE"),
  L("fiche:coca", "Coca", "Limonade et autre", "BAR"),
];
const VENTES = { "fiche:carbo_2026-09-01": 12, "fiche:carbo_2026-09-02": 0, "fiche:coca_2026-08-31": 5 };

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  m.saisirVente.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(VentesGrid, { lignes: LIGNES, jours: JOURS, ventes: VENTES, peutModifier: true })));
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const rangees = () => [...conteneur.querySelectorAll("tbody tr")];
const casesDe = (designation: string) => [...rangees().find((r) => r.querySelector("td")?.textContent?.startsWith(designation))!.querySelectorAll("input")];
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("grille des ventes", () => {
  it("Cuisine puis Bar, rubriques du classeur, fiche désactivée signalée, un total PAR ESPACE ; aucune case type=number", () => {
    expect(rangees().map((r) => r.querySelector("td")!.textContent)).toEqual([
      "Cuisine — plats vendus", "Pâtes classiques", "Carbonara", "Bolognaise(désactivé)", "Desserts", "Crème brûlée", "Total jour — Cuisine",
      "Bar — boissons vendues", "Limonade et autre", "Coca", "Total jour — Bar",
    ]);
    expect(conteneur.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(conteneur.querySelector("table[data-tableur]")).not.toBeNull();
  });

  it("case vide = « — » (rien saisi), 0 saisi = 0 ; totaux : « — » quand rien n'est saisi", () => {
    const carbo = casesDe("Carbonara");
    expect(carbo.map((c) => c.value)).toEqual(["", "12", "0", "", "", ""]);
    expect(carbo.every((c) => c.placeholder === "—")).toBe(true);
    const cellulesCarbo = [...rangees().find((r) => r.textContent?.startsWith("Carbonara"))!.querySelectorAll("td")];
    expect(cellulesCarbo.at(-1)!.textContent).toBe("12");
    const creme = [...rangees().find((r) => r.textContent?.startsWith("Crème brûlée"))!.querySelectorAll("td")];
    expect(creme.at(-1)!.textContent).toBe("—");
    // Jamais plats + boissons : un total par espace.
    const total = (e: string) => [...conteneur.querySelectorAll(`tr[data-total="${e}"] td`)].map((t) => t.textContent);
    expect(total("CUISINE")).toEqual(["Total jour — Cuisine", "—", "12", "0", "—", "—", "—", "12"]);
    expect(total("BAR")).toEqual(["Total jour — Bar", "5", "—", "—", "—", "—", "—", "5"]);
    expect(conteneur.querySelector("tfoot")).toBeNull();
  });

  it("un jour de période clôturée est en lecture seule, les autres restent saisissables", () => {
    const coca = casesDe("Coca");
    expect(coca[0]!.disabled).toBe(true);
    expect(coca[0]!.value).toBe("5"); // la valeur reste lisible
    expect(coca.slice(1).every((c) => !c.disabled)).toBe(true);
    expect(conteneur.querySelector("thead")!.textContent).toContain("(clôturé)");
  });

  it("saisir 0 envoie 0 ; vider une case envoie null (saisie retirée), jamais 0", async () => {
    const carbo = casesDe("Carbonara");
    act(() => carbo[3]!.focus());
    taper(carbo[3]!, "0");
    await act(async () => { carbo[3]!.blur(); });
    act(() => carbo[1]!.focus());
    taper(carbo[1]!, "");
    await act(async () => { carbo[1]!.blur(); });
    expect(m.saisirVente.mock.calls).toEqual([["fiche:carbo", "2026-09-03", 0], ["fiche:carbo", "2026-09-01", null]]);
  });

  it("un nombre décimal est refusé sur la case, rien n'est envoyé", async () => {
    const carbo = casesDe("Carbonara");
    act(() => carbo[4]!.focus());
    taper(carbo[4]!, "2,5");
    await act(async () => { carbo[4]!.blur(); });
    expect(m.saisirVente).not.toHaveBeenCalled();
  });
});
