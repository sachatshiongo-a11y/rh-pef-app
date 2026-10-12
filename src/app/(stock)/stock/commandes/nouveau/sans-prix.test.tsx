// @vitest-environment happy-dom
//
// Nouveau bon de commande : une ligne SANS PRIX est signalée (« sans prix », jamais « 0,00 $ ») et le total est
// annoncé incomplet (audit du 10/10/2026, stock 19).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../actions", () => ({ creerBonCommande: vi.fn(), modifierBonCommande: vi.fn() }));
import { NouveauBonForm } from "./nouveau-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(lignes: { designation: string; quantite: string; prix: string }[]) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(NouveauBonForm, {
    articles: [], fournisseurs: [],
    initial: { bcId: "b1", fournisseurId: null, delaiPaiement: "", modePaiement: "", commentaire: "", lignes: lignes.map((l) => ({ articleId: "", uniteParCarton: "", ...l })) },
  })));
}

describe("bon de commande : ligne sans prix", () => {
  it("la ligne sans prix est signalée et le total est annoncé incomplet", () => {
    monter([{ designation: "Farine", quantite: "10", prix: "5" }, { designation: "Transport", quantite: "1", prix: "" }]);
    expect(conteneur.querySelectorAll("[data-sans-prix]")).toHaveLength(1);
    expect(conteneur.querySelector("[data-total-incomplet]")?.textContent).toContain("incomplet : 1 ligne(s) sans prix");
    expect(conteneur.textContent).toContain("50,00 $"); // le total chiffre les lignes qui ont un prix
  });
  it("aucune ligne chiffrée : « — », jamais « 0,00 $ » en total", () => {
    monter([{ designation: "Transport", quantite: "1", prix: "" }]);
    expect(conteneur.querySelector("[data-total-incomplet]")).toBeTruthy();
    expect(conteneur.textContent).not.toMatch(/Total : 0,00 \$/);
  });
  it("toutes les lignes chiffrées : aucune mention", () => {
    monter([{ designation: "Farine", quantite: "10", prix: "5" }]);
    expect(conteneur.querySelector("[data-total-incomplet]")).toBeNull();
  });
});
