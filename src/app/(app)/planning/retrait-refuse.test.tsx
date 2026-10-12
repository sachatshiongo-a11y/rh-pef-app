// @vitest-environment happy-dom
//
// Planning : retirer un shift d'un poste / une règle de polyvalence. Le retrait demande confirmation et un
// refus du serveur (« seule la Direction supprime ») s'affiche au lieu d'être avalé (audit du 10/10/2026,
// ergonomie 1 et 4).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  supprimerShiftPoste: vi.fn<(id: string) => Promise<unknown>>(async () => undefined),
  supprimerPolyvalence: vi.fn<(id: string) => Promise<unknown>>(async () => undefined),
}));
vi.mock("./actions", () => ({
  definirShiftPoste: vi.fn(), deplacerShiftPoste: vi.fn(), definirPolyvalence: vi.fn(),
  supprimerShiftPoste: m.supprimerShiftPoste, supprimerPolyvalence: m.supprimerPolyvalence,
}));

import { ShiftPosteManager } from "./shift-poste-manager";
import { PolyvalenceManager } from "./polyvalence-manager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function monter(el: ReturnType<typeof h>) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(el));
}
const cliquer = async (b: HTMLElement | undefined) => { await act(async () => b!.click()); };

describe("Shifts par poste — retirer", () => {
  const el = () => h(ShiftPosteManager, { postes: ["Cuisinier"], shifts: [{ id: "s1", nom: "Matin" }], shiftsPoste: [{ id: "sp1", poste: "Cuisinier", shiftId: "s1", ordre: 0 }], peutRetirer: true });

  it("confirmation avant le retrait ; refus de la confirmation = rien n'est envoyé", async () => {
    vi.stubGlobal("confirm", () => false);
    monter(el());
    await cliquer(conteneur.querySelector<HTMLElement>('button[title="Retirer"]')!);
    expect(m.supprimerShiftPoste).not.toHaveBeenCalled();
  });

  it("refus du serveur : le message est affiché", async () => {
    vi.stubGlobal("confirm", () => true);
    m.supprimerShiftPoste.mockResolvedValueOnce({ erreur: "Seule la Direction peut supprimer." });
    monter(el());
    await cliquer(conteneur.querySelector<HTMLElement>('button[title="Retirer"]')!);
    expect(m.supprimerShiftPoste).toHaveBeenCalledWith("sp1");
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Seule la Direction peut supprimer.");
  });
});

describe("Polyvalence des postes — retirer", () => {
  const el = () => h(PolyvalenceManager, { postes: ["Chef", "Commis"], polyvalences: [{ id: "p1", posteSource: "Chef", posteCible: "Commis" }], peutRetirer: true });

  it("confirmation avant le retrait", async () => {
    vi.stubGlobal("confirm", () => false);
    monter(el());
    await cliquer([...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Retirer"));
    expect(m.supprimerPolyvalence).not.toHaveBeenCalled();
  });

  it("refus du serveur : le message est affiché", async () => {
    vi.stubGlobal("confirm", () => true);
    m.supprimerPolyvalence.mockResolvedValueOnce({ erreur: "Seule la Direction peut supprimer." });
    monter(el());
    await cliquer([...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Retirer"));
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Seule la Direction peut supprimer.");
  });
});
