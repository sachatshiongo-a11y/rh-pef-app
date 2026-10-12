// @vitest-environment happy-dom
//
// Totaux de valeur de l'écran Mouvements (audit du 10/10/2026, stock 10) : un mouvement sans prix n'est
// pas compté 0 en silence — le total est annoncé « partiel : N sans prix », « — » quand rien n'a de valeur.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({
  mouvementManuel: vi.fn(), supprimerMouvement: vi.fn(), supprimerMouvementsEnLot: vi.fn(),
  requalifierSorties: vi.fn(), changerDateSorties: vi.fn(),
}));
const { ColonneMouvements } = await import("./mouvements-client");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const M = (id: string, valeur: number | null) => ({
  id, articleId: `a-${id}`, designation: `Article ${id}`, dateISO: "2026-09-29", origine: "x", type: "SORTIE", quantite: 1, unite: "kg",
  valeur, valeurEstimee: false, facture: null, bc: null, fournId: null, fournNom: null, motif: null,
});
function monter(mouvements: ReturnType<typeof M>[]) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(ColonneMouvements, { titre: "Sorties", signe: "−", couleur: "", estDirection: true, mouvements })));
}

describe("totaux de valeur des Mouvements", () => {
  it("un mouvement sans prix rend le total partiel, annoncé", () => {
    monter([M("1", 2.5), M("2", null), M("3", 4)]);
    expect(conteneur.textContent).toContain("≈ 6,50 $ · partiel : 1 sans prix");
  });
  it("aucune valeur connue : « — », jamais « ≈ 0,00 $ »", () => {
    monter([M("1", null), M("2", null)]);
    expect(conteneur.textContent).toContain("— · 2 sans prix");
    expect(conteneur.textContent).not.toContain("0,00 $");
  });
  it("tout est valorisé : total sans mention", () => {
    monter([M("1", 2.5), M("2", 4)]);
    expect(conteneur.textContent).toContain("≈ 6,50 $");
    expect(conteneur.textContent).not.toContain("partiel");
  });
});
