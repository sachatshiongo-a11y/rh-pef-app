// @vitest-environment happy-dom
//
// Propositions de rattachement : les deux unités s'affichent à côté de chaque proposition, une
// proposition « unités incompatibles » ou « unité manquante » est signalée, reste cochable une à
// une, mais « Tout sélectionner » (acceptation groupée) ne la coche jamais.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Proposition } from "@/lib/fiches/rattachement-resto";

const accepter = vi.hoisted(() => vi.fn(async (_ids: string[]) => ({ n: 0, ignores: 0 })));
vi.mock("./actions", () => ({ accepterPropositions: accepter }));

const { PropositionsRattachement } = await import("./propositions-rattachement");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P = (id: string, uniteResto: string | null, uniteCatalogue: string | null, alerteUnite: Proposition["alerteUnite"]): Proposition => ({
  articleRestoId: id, designationResto: `Resto ${id}`, articleStockId: `a-${id}`, designationCatalogue: `Catalogue ${id}`,
  uniteResto, uniteCatalogue, alerteUnite,
});
const PROPOSITIONS = [
  P("farine", "g", "kg", null),
  P("vin", "bouteille", "l", "UNITES_INCOMPATIBLES"),
  P("sel", null, "kg", "UNITE_MANQUANTE"),
  P("beurre", "kg", "kg", null),
];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  accepter.mockClear();
});
function monter() {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(PropositionsRattachement, { propositions: PROPOSITIONS })));
}
const ligne = (id: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Rattacher Resto ${id}"]`)!.closest("li")!;
const caseDe = (id: string) => conteneur.querySelector<HTMLInputElement>(`[aria-label="Rattacher Resto ${id}"]`)!;
const toutSelectionner = () => [...conteneur.querySelectorAll("label")].find((l) => l.textContent?.includes("Tout sélectionner"))!.querySelector("input")!;
const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes(texte))!;

describe("propositions de rattachement — unités", () => {
  it("affiche l'unité du restaurant et celle du catalogue, et signale l'incompatibilité ou le manque", () => {
    monter();
    expect(ligne("farine").textContent).toContain("g → kg");
    expect(ligne("farine").textContent).not.toMatch(/incompatibles|manquante/);
    expect(ligne("vin").textContent).toContain("bouteille → l");
    expect(ligne("vin").textContent).toContain("unités incompatibles");
    expect(ligne("sel").textContent).toContain("— → kg");
    expect(ligne("sel").textContent).toContain("unité manquante");
  });

  it("« Tout sélectionner » ne coche que les propositions sans alerte ; les signalées restent cochables une à une", async () => {
    monter();
    act(() => toutSelectionner().click());
    expect(["farine", "vin", "sel", "beurre"].map((id) => caseDe(id).checked)).toEqual([true, false, false, true]);
    await act(async () => bouton("Rattacher (").click());
    expect(accepter).toHaveBeenCalledWith(["farine", "beurre"]);

    act(() => caseDe("vin").click());
    expect(caseDe("vin").checked).toBe(true);
    await act(async () => bouton("Rattacher (").click());
    expect(accepter.mock.calls.at(-1)![0]).toEqual(["vin"]);
  });
});
