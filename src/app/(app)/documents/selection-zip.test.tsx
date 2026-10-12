// @vitest-environment happy-dom
//
// Documents : les onglets qui ont une archive ZIP (congés, fiches de poste) offrent cases à cocher + téléchargement
// groupé ; les autres onglets s'affichent tels quels (audit du 10/10/2026, ergonomie 7).
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SelectionZip, CaseZip, type LotZip } from "./selection-zip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOT: LotZip = { ids: ["a", "b", "c"], href: "/conges/pdf-lot", max: 2, libelle: "les PDF", nomFichier: "Demandes_de_conge.zip", totalFiltre: 3 };
let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(lot: LotZip | null) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(SelectionZip, { lot, children: LOT.ids.map((id) => h("div", { key: id }, h(CaseZip, { id, libelle: `Sélectionner ${id}` }), id)) })));
}
const cases = () => [...conteneur.querySelectorAll<HTMLInputElement>('div > input[type="checkbox"]')].filter((c) => c.getAttribute("aria-label")?.startsWith("Sélectionner "));

describe("SelectionZip", () => {
  it("avec un lot : une case par ligne, lien ZIP des cochés", () => {
    monter({ ...LOT, max: 5 });
    expect(cases()).toHaveLength(3);
    act(() => cases()[0].click());
    act(() => cases()[2].click());
    const lien = conteneur.querySelector(".sticky a")!;
    expect(lien.textContent?.trim()).toBe("⭳ Télécharger les PDF (2)");
  });

  it("au-delà du plafond de la route, le lien est remplacé par un bouton désactivé qui le dit", () => {
    monter(LOT);
    for (const c of cases()) act(() => c.click());
    expect(conteneur.querySelector(".sticky a")).toBeNull();
    expect(conteneur.querySelector<HTMLButtonElement>(".sticky button[disabled]")!.textContent).toBe("Archive : 2 au plus à la fois");
  });

  it("sans lot (bulletins, contrats, documents RH, attestations) : ni cases ni barre", () => {
    monter(null);
    expect(cases()).toHaveLength(0);
    expect(conteneur.querySelector(".sticky")).toBeNull();
    expect(conteneur.textContent).toContain("abc");
  });

  it("« Tout sélectionner » coche la page", () => {
    monter({ ...LOT, max: 5 });
    act(() => conteneur.querySelector<HTMLInputElement>('.sticky input[type="checkbox"]')!.click());
    expect(cases().every((c) => c.checked)).toBe(true);
  });
});
