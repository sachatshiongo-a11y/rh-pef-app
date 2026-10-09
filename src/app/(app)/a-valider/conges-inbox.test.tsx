// @vitest-environment happy-dom
//
// « À VALIDER » — les demandes de congé : refuser (à l'unité ou en lot) exige un MOTIF, comme sur l'écran Congés.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const M = vi.hoisted(() => ({
  approuverConge: vi.fn(async () => ({})),
  refuserConge: vi.fn(async (_id: string, _motif: string) => ({} as { erreur?: string })),
  supprimerConge: vi.fn(),
  approuverCongesEnLot: vi.fn(async (ids: string[]) => ({ traitees: ids.length, echecs: [] as string[] })),
  refuserCongesEnLot: vi.fn(async (ids: string[], _motif: string) => ({ traitees: ids.length, echecs: [] as string[] })),
}));
vi.mock("../conges/actions", () => M);

import { CongesInbox, type CongeRow } from "./conges-inbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROWS: CongeRow[] = ["a", "b"].map((id, i) => ({
  id, employeeId: `e-${id}`, nom: i === 0 ? "Aimée Mutita" : "Bijou Mputu", type: "Congé annuel", du: "05/11/2026", au: "09/11/2026", jours: 5, echeanceTexte: "dans 3 j", echeanceClasse: "",
}));
let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  Object.values(M).forEach((f) => f.mockClear());
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(CongesInbox, { rows: ROWS, peutValider: true })));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const bouton = (re: RegExp, zone: ParentNode = conteneur) => [...zone.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""))!;
const dialogue = () => document.querySelector<HTMLElement>("[data-dialogue-refus]");
function motif(texte: string) {
  const zone = dialogue()!.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(zone, texte);
  act(() => { zone.dispatchEvent(new Event("input", { bubbles: true })); });
}
const envoyer = async () => { await act(async () => { dialogue()!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("À valider — refus avec motif", () => {
  it("Refuser sur une demande : une fenêtre exige le motif ; sans motif le bouton est inactif et rien n'est appelé", async () => {
    act(() => bouton(/Refuser$/, conteneur.querySelectorAll<HTMLElement>(".rounded-xl")[0]).click());
    expect(dialogue()?.textContent).toContain("Demande de Aimée Mutita");
    expect(bouton(/Refuser$/, dialogue()!).disabled).toBe(true);
    await envoyer();
    expect(M.refuserConge).not.toHaveBeenCalled();
    motif("Trop de monde en congé");
    await envoyer();
    expect(M.refuserConge).toHaveBeenCalledWith("a", "Trop de monde en congé");
    expect(dialogue()).toBeNull();
  });

  it("en lot : UN motif pour la sélection, passé à l'action de lot", async () => {
    act(() => { conteneur.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click(); }); // « Tout sélectionner »
    act(() => bouton(/Refuser$/, conteneur.querySelector<HTMLElement>(".mb-3")!).click());
    expect(dialogue()?.textContent).toContain("Refuser 2 demandes de congé");
    motif("Fermeture exceptionnelle");
    await envoyer();
    expect(M.refuserCongesEnLot).toHaveBeenCalledWith(["a", "b"], "Fermeture exceptionnelle");
  });

  it("un motif refusé par le serveur reste affiché dans la fenêtre (rien n'est fermé)", async () => {
    M.refuserConge.mockResolvedValueOnce({ erreur: "Un motif est obligatoire pour refuser une demande de congé." });
    act(() => bouton(/Refuser$/, conteneur.querySelectorAll<HTMLElement>(".rounded-xl")[1]).click());
    motif("x");
    await envoyer();
    expect(dialogue()?.querySelector('[role="alert"]')?.textContent).toContain("Un motif est obligatoire");
  });

  it("Annuler ne refuse rien", () => {
    act(() => bouton(/Refuser$/, conteneur.querySelectorAll<HTMLElement>(".rounded-xl")[0]).click());
    act(() => bouton(/^Annuler$/, dialogue()!).click());
    expect(dialogue()).toBeNull();
    expect(M.refuserConge).not.toHaveBeenCalled();
  });
});
