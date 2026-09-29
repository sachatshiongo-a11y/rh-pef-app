// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuFicheCommande, MenuFichesConso } from "./menu-fiches-conso";

// Menu des fiches de l'onglet Consommation : même bouton à menu que les fiches de Légumes frais,
// le rapport (ventes) et la consommation réelle de la semaine affichée, la commande d'un jour au
// choix, en PDF et en Excel.

function rendre(domaine?: string) {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(<MenuFichesConso semaine="2026-09-21" jourDefaut="2026-09-22" domaine={domaine} libelleSemaine="Semaine du 21/9 au 27/9" />);
  return div;
}

describe("menu des fiches de consommation", () => {
  it("rapport (ventes) et consommation réelle de la semaine affichée (PDF, Excel) ; commande du jour proposé, filtre de l'écran repris", () => {
    const div = rendre("BOISSON");
    expect(div.querySelector("summary")!.textContent).toContain("Fiches (PDF / Excel)");
    expect([...div.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.hasAttribute("download")])).toEqual([
      ["PDF", "/stock/journalier/fiche?type=rapport&semaine=2026-09-21&domaine=BOISSON&format=pdf", true],
      ["Excel", "/stock/journalier/fiche?type=rapport&semaine=2026-09-21&domaine=BOISSON&format=excel", true],
      ["PDF", "/stock/journalier/fiche?type=consommation&semaine=2026-09-21&domaine=BOISSON&format=pdf", true],
      ["Excel", "/stock/journalier/fiche?type=consommation&semaine=2026-09-21&domaine=BOISSON&format=excel", true],
    ]);
    // Le rapport journalier liste les ventes ; la consommation réelle garde son propre nom.
    const titres = [...div.querySelectorAll("p.font-medium")].map((p) => p.textContent);
    expect(titres).toEqual(["Rapport journalier cuisine et bar", "Consommation réelle du restaurant", "Commande journalière"]);
    expect(div.textContent).toContain("Plats et boissons vendus");
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

// Onglet Commande : la « Commande journalière » sur le modèle du classeur — un jour de la semaine
// affichée (Cuisine puis Bar), ou toute la semaine en un fichier — et, en second, le tableau brut.
describe("menu de l'onglet Commande", () => {
  const JOURS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  function rendreCommande(domaine?: string, jourDefaut = "2026-09-29") {
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(<MenuFicheCommande semaine="2026-09-28" jours={JOURS} jourDefaut={jourDefaut} domaine={domaine} libelleSemaine="Semaine du 28/9 au 4/10" />);
    return div;
  }

  it("même bouton à menu que les autres fiches, ouvert vers la droite", () => {
    const div = rendreCommande();
    expect(div.querySelector("summary")!.textContent).toContain("Commande journalière (PDF / Excel)");
    expect(div.querySelector("details > div")!.className).toContain("left-0");
    expect([...div.querySelectorAll("p.font-medium")].map((p) => p.textContent)).toEqual(["Un jour", "Toute la semaine", "Tableau de la semaine"]);
  });

  it("un jour : sélecteur des 7 jours de la semaine affichée, jour proposé présélectionné, filtre de l'écran repris", () => {
    const div = rendreCommande("NOURRITURE");
    const form = div.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/stock/journalier/fiche");
    expect(form.getAttribute("method")).toBe("get");
    const options = [...form.querySelectorAll("select[name=date] option")];
    expect(options.map((o) => o.getAttribute("value"))).toEqual(JOURS);
    expect(options[0]!.textContent).toBe("lundi 28 septembre 2026");
    expect(options.filter((o) => o.hasAttribute("selected")).map((o) => o.getAttribute("value"))).toEqual(["2026-09-29"]);
    const caches = Object.fromEntries([...form.querySelectorAll("input[type=hidden]")].map((i) => [i.getAttribute("name"), i.getAttribute("value")]));
    expect(caches).toEqual({ type: "commande", domaine: "NOURRITURE" });
    expect([...form.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("name"), b.getAttribute("value")])).toEqual([
      ["PDF", "format", "pdf"], ["Excel", "format", "excel"],
    ]);
  });

  it("toute la semaine (fiche du modèle) puis tableau brut de la semaine, PDF et Excel, filtre repris", () => {
    const div = rendreCommande("BOISSON");
    expect([...div.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.hasAttribute("download")])).toEqual([
      ["PDF", "/stock/journalier/fiche?type=commande&tout=1&semaine=2026-09-28&domaine=BOISSON&format=pdf", true],
      ["Excel", "/stock/journalier/fiche?type=commande&tout=1&semaine=2026-09-28&domaine=BOISSON&format=excel", true],
      ["PDF", "/stock/journalier/pdf?vue=commande&semaine=2026-09-28&domaine=BOISSON", true],
      ["Excel", "/stock/journalier/excel?vue=commande&semaine=2026-09-28&domaine=BOISSON", true],
    ]);
  });

  it("sans filtre : aucun domaine transmis (fiche cuisine puis fiche bar)", () => {
    const div = rendreCommande();
    expect(div.querySelector('input[name="domaine"]')).toBeNull();
    expect(div.querySelector("a")!.getAttribute("href")).toBe("/stock/journalier/fiche?type=commande&tout=1&semaine=2026-09-28&format=pdf");
  });
});
