// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuFichesConso } from "./menu-fiches-conso";

// Menu des fiches de l'onglet Consommation : même bouton à menu que les fiches de Légumes frais,
// le rapport de la semaine affichée et la commande d'un jour au choix, en PDF et en Excel.

function rendre(domaine?: string) {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(<MenuFichesConso semaine="2026-09-21" jourDefaut="2026-09-22" domaine={domaine} libelleSemaine="Semaine du 21/9 au 27/9" />);
  return div;
}

describe("menu des fiches de consommation", () => {
  it("rapport de la semaine affichée (PDF, Excel) ; commande du jour proposé, filtre de l'écran repris", () => {
    const div = rendre("BOISSON");
    expect(div.querySelector("summary")!.textContent).toContain("Fiches (PDF / Excel)");
    expect([...div.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.hasAttribute("download")])).toEqual([
      ["PDF", "/stock/journalier/fiche?type=rapport&semaine=2026-09-21&domaine=BOISSON&format=pdf", true],
      ["Excel", "/stock/journalier/fiche?type=rapport&semaine=2026-09-21&domaine=BOISSON&format=excel", true],
    ]);
    const form = div.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/stock/journalier/fiche");
    expect(form.getAttribute("method")).toBe("get");
    const champs = Object.fromEntries([...form.querySelectorAll("input")].map((i) => [i.getAttribute("name"), i.getAttribute("value")]));
    expect(champs).toEqual({ type: "commande", domaine: "BOISSON", date: "2026-09-22" });
    expect([...form.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("name"), b.getAttribute("value")])).toEqual([
      ["PDF", "format", "pdf"], ["Excel", "format", "excel"],
    ]);
  });

  it("sans filtre : aucun domaine transmis (les deux fiches, cuisine et bar)", () => {
    const div = rendre();
    expect(div.querySelector("a")!.getAttribute("href")).toBe("/stock/journalier/fiche?type=rapport&semaine=2026-09-21&format=pdf");
    expect(div.querySelector('input[name="domaine"]')).toBeNull();
  });
});
