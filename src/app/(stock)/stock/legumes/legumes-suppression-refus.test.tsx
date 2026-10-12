// @vitest-environment happy-dom
//
// Suppression d'une ligne de l'historique des achats de légumes (Direction) : un refus du serveur
// (période clôturée…) s'affiche à côté du bouton au lieu d'être avalé (audit du 10/10/2026, ergonomie 1).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({ supprimer: vi.fn<(id: string) => Promise<unknown>>(async () => undefined) }));
vi.mock("./actions", () => ({ creerAchatsLegumes: vi.fn(), supprimerAchatLegume: m.supprimer }));

import { SupprimerAchatBtn } from "./legumes-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.unstubAllGlobals(); m.supprimer.mockClear(); });
function monter(estDirection = true) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(SupprimerAchatBtn, { id: "a1", legume: "Tomate", estDirection })));
}
const cliquer = async () => { await act(async () => conteneur.querySelector("button")!.click()); };

describe("SupprimerAchatBtn — le refus du serveur est dit", () => {
  it("période close : le message s'affiche (role=alert) à côté du bouton", async () => {
    vi.stubGlobal("confirm", () => true);
    m.supprimer.mockResolvedValueOnce({ erreur: "Le mois d'août 2026 est clôturé : suppression impossible." });
    monter();
    await cliquer();
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Le mois d'août 2026 est clôturé : suppression impossible.");
  });

  it("accepté : aucun message ; refusé à la confirmation : l'action n'est pas appelée", async () => {
    vi.stubGlobal("confirm", () => true);
    monter();
    await cliquer();
    expect(m.supprimer).toHaveBeenCalledWith("a1");
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
    m.supprimer.mockClear();
    vi.stubGlobal("confirm", () => false);
    await cliquer();
    expect(m.supprimer).not.toHaveBeenCalled();
  });

  it("hors Direction : aucun bouton", () => {
    monter(false);
    expect(conteneur.querySelector("button")).toBeNull();
  });
});
