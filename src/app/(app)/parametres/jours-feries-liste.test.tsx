// @vitest-environment happy-dom
//
// Jours fériés : cases à cocher et suppression GROUPÉE avec confirmation (audit du 10/10/2026, ergonomie 4 et 7).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  lot: vi.fn<(ids: number[]) => Promise<unknown>>(async (ids) => ({ traitees: ids.length, messages: ids.map((i) => `Férié n° ${i} retiré.`), echecs: [] })),
}));
vi.mock("./actions", () => ({ supprimerJoursFeriesEnLot: m.lot }));

import { JoursFeriesListe } from "./jours-feries-liste";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FERIES = [{ id: 1, date: "01/01/2026", designation: "Nouvel an" }, { id: 2, date: "30/06/2026", designation: "Indépendance" }, { id: 3, date: "25/12/2026", designation: "Noël" }];
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(JoursFeriesListe, { feries: FERIES })));
}
const cases = () => [...conteneur.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]")];
const bouton = (re: RegExp) => [...conteneur.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;

describe("JoursFeriesListe", () => {
  it("une case par férié ; suppression groupée après confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    monter();
    expect(cases()).toHaveLength(3);
    act(() => cases()[0].click());
    act(() => cases()[2].click());
    await act(async () => bouton(/Supprimer \(2\)/).click());
    expect(m.lot).toHaveBeenCalledWith([1, 3]);
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("Férié n° 1 retiré. Férié n° 3 retiré.");
  });

  it("confirmation refusée : rien n'est retiré", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    monter();
    act(() => cases()[0].click());
    await act(async () => bouton(/Supprimer \(1\)/).click());
    expect(m.lot).not.toHaveBeenCalled();
  });

  it("le « Supprimer » d'une ligne demande aussi confirmation et ne retire que ce férié", async () => {
    const confirmer = vi.fn((_m?: string) => true);
    vi.stubGlobal("confirm", confirmer);
    monter();
    await act(async () => conteneur.querySelectorAll<HTMLButtonElement>("tbody button")[1].click());
    expect(confirmer.mock.calls[0][0]).toContain("« Indépendance » (30/06/2026)");
    expect(m.lot).toHaveBeenCalledWith([2]);
  });

  it("un refus du serveur est affiché", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    m.lot.mockResolvedValueOnce({ erreur: "Retirez 50 fériés au plus à la fois." });
    monter();
    act(() => cases()[0].click());
    await act(async () => bouton(/Supprimer \(1\)/).click());
    expect(conteneur.querySelector('[role="status"]')?.textContent).toBe("Retirez 50 fériés au plus à la fois.");
  });
});
