// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableComparaison } from "./table-comparaison";
import type { LigneComparaison } from "@/lib/journalier-restaurant";

// Onglet Comparaison : commandé, livré et consommé côte à côte ; les écarts livré / consommé sont
// marqués ; un consommé inconnu s'écrit « — », sans écart ni total partiel.

const JOURS = [{ iso: "2026-09-21", label: "Lun 21" }, { iso: "2026-09-22", label: "Mar 22" }];
const L = (p: Partial<LigneComparaison> & { designation: string }): LigneComparaison => ({
  id: p.designation, categorie: "Épicerie", lien: true, cmd: [0, 0], liv: [0, 0], conso: [null, null], ecarts: [null, null], ...p,
});

function monter(lignes: LigneComparaison[], sansMotif = 0) {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(<TableComparaison jours={JOURS} lignes={lignes} sansMotif={sansMotif} />);
  return div;
}
const cellules = (div: HTMLElement, designation: string) => [...div.querySelector(`tr[data-article="${designation}"]`)!.children].map((td) => td.textContent?.trim());

describe("onglet Comparaison", () => {
  it("C / L / Cs par jour, écarts marqués, « — » quand le consommé est inconnu", () => {
    const div = monter([
      L({ designation: "Farine", cmd: [3, 0], liv: [2, 0], conso: ["1.5", "0.25"], ecarts: ["LIVRE_NON_CONSOMME", "CONSOMME_PLUS_QUE_LIVRE"] }),
      L({ designation: "Sel", cmd: [1, 0], liv: [1, 0] }),
    ]);
    expect(cellules(div, "Farine")).toEqual(["Farine", "3", "2", "1,5", "", "", "0,25", "3", "2", "1,75"]);
    expect(cellules(div, "Sel")).toEqual(["Sel", "1", "1", "—", "", "", "—", "1", "1", "—"]);
    const ecarts = [...div.querySelectorAll('[data-vue="semaine"] [data-ecart]')].map((td) => [td.getAttribute("data-ecart"), td.getAttribute("title")]);
    expect(ecarts).toEqual([["LIVRE_NON_CONSOMME", "livré non consommé"], ["CONSOMME_PLUS_QUE_LIVRE", "consommé plus que livré"]]);
  });

  it("les sorties sans motif sont annoncées, pas comptées comme livrées", () => {
    expect(monter([], 2).textContent).toContain("2 article(s) sorti(s) du dépôt sans motif");
    expect(monter([], 0).textContent).not.toContain("sans motif cette semaine");
  });
});
