// @vitest-environment happy-dom
//
// Rapport journalier (ventes) sur téléphone : la liste d'UN jour, mêmes lignes que la grille, même action
// `saisirVente` avec les mêmes arguments (null pour une case vidée, jamais 0), total PAR ESPACE,
// jour clôturé en lecture seule.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LigneVente } from "@/lib/ventes-journalieres";

const m = vi.hoisted(() => ({
  saisirVente: vi.fn<(ligne: string, jour: string, q: number | null) => Promise<{ ok: true }>>(async () => ({ ok: true })),
  rafraichirJournalier: vi.fn(async () => {}),
}));
vi.mock("./ventes-actions", () => ({ saisirVente: m.saisirVente }));
vi.mock("./actions", () => ({ rafraichirJournalier: m.rafraichirJournalier }));

import { VentesGrid, type JourVente } from "./ventes-grid";
import { JourMobileProvider } from "@/components/jour-mobile";
import { SelecteurJour } from "@/components/selecteur-jour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS: JourVente[] = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"].map((iso, i) => ({ iso, label: `J${i}`, fige: iso === "2026-09-28" }));
const L = (cle: string, designation: string, rubrique: string, espace: "CUISINE" | "BAR"): LigneVente => ({ cle, designation, rubrique, espace, inactif: false });
const LIGNES = [L("fiche:carbo", "Carbonara", "Pâtes", "CUISINE"), L("fiche:creme", "Crème brûlée", "Desserts", "CUISINE"), L("fiche:coca", "Coca", "Boissons", "BAR")];
const VENTES = { "fiche:carbo_2026-09-30": 12, "fiche:creme_2026-09-30": 0, "fiche:coca_2026-09-30": 5, "fiche:carbo_2026-09-28": 3 };

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  m.saisirVente.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(
    <JourMobileProvider defaultIdx={2}>
      <SelecteurJour jours={JOURS} aujourdhui="2026-09-30" />
      <VentesGrid lignes={LIGNES} jours={JOURS} ventes={VENTES} peutModifier />
    </JourMobileProvider>,
  ));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const liste = () => conteneur.querySelector<HTMLElement>('[data-vue="jour"] [data-vue-liste="ventes"]')!;
const caseJour = (libelle: string) => [...liste().querySelectorAll<HTMLInputElement>("input")].find((i) => i.getAttribute("aria-label") === libelle)!;
function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Rapport journalier sur téléphone — la liste du jour", () => {
  it("jour courant par défaut, une case par ligne, « — » (case vide) distinct de 0, un total par espace", () => {
    expect(liste().querySelector("h2")!.textContent).toBe("mercredi 30 septembre");
    const cases = [...liste().querySelectorAll<HTMLInputElement>("input")];
    expect(cases.map((i) => i.getAttribute("aria-label"))).toEqual(["Carbonara — J2", "Crème brûlée — J2", "Coca — J2"]);
    expect(cases.map((i) => i.value)).toEqual(["12", "0", "5"]); // 0 saisi reste 0
    expect(cases.map((i) => i.getAttribute("placeholder"))).toEqual(["—", "—", "—"]);
    const totaux = [...liste().querySelectorAll("[data-total]")].map((t) => [t.getAttribute("data-total"), t.textContent]);
    expect(totaux).toEqual([["CUISINE", "Total jour — Cuisine12"], ["BAR", "Total jour — Bar5"]]);
    expect(liste().textContent).toContain("Cuisine — plats vendus");
  });

  it("saisie mobile : saisirVente(cle, date du jour, nombre) — comme la grille ; vidée = null, jamais 0", async () => {
    const grille = [...conteneur.querySelectorAll<HTMLInputElement>('[data-vue="semaine"] tbody input')].find((i) => i.getAttribute("aria-label") === "Carbonara — J2")!;
    act(() => grille.focus()); taper(grille, "14"); await act(async () => { grille.blur(); });
    const viaGrille = m.saisirVente.mock.calls.at(-1);
    const c = caseJour("Carbonara — J2");
    act(() => c.focus()); taper(c, "15"); await act(async () => { c.blur(); });
    expect(viaGrille).toEqual(["fiche:carbo", "2026-09-30", 14]);
    expect(m.saisirVente.mock.calls.at(-1)).toEqual(["fiche:carbo", "2026-09-30", 15]);
    const z = caseJour("Coca — J2");
    act(() => z.focus()); taper(z, ""); await act(async () => { z.blur(); });
    expect(m.saisirVente.mock.calls.at(-1)).toEqual(["fiche:coca", "2026-09-30", null]);
    // Le total du jour suit la saisie : 15 (carbo) + 0 (crème).
    expect(liste().querySelector('[data-total="CUISINE"]')!.textContent).toContain("15");
    expect(liste().querySelector('[data-total="BAR"]')!.textContent).toContain("—");
  });

  it("Entrée descend à la ligne suivante", async () => {
    const c = caseJour("Carbonara — J2");
    act(() => c.focus());
    await act(async () => { c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(caseJour("Crème brûlée — J2"));
  });

  it("un jour clôturé est en lecture seule, annoncé, et n'envoie rien", () => {
    act(() => { conteneur.querySelector<HTMLButtonElement>('[data-selecteur-jour] button[aria-label^="lundi"]')!.click(); });
    const cases = [...liste().querySelectorAll<HTMLInputElement>("input")];
    expect(cases.every((i) => i.disabled)).toBe(true);
    expect(liste().textContent).toContain("(clôturé)");
    expect(liste().textContent).toContain("lecture seule");
    expect(m.saisirVente).not.toHaveBeenCalled();
  });

  it("le tableau de la semaine reste rendu, avec sa première colonne figée", () => {
    const semaine = conteneur.querySelector('[data-vue="semaine"]')!;
    expect(semaine.querySelector("table")).not.toBeNull();
    expect(semaine.querySelector("tbody td")!.className).toContain("sticky");
    expect(semaine.className).toContain("max-lg:hidden");
  });
});
