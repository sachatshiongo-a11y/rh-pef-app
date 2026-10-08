// @vitest-environment happy-dom
//
// Menu « Exporter » de l'Inventaire : les liens portent le filtre AFFICHÉ (domaine, recherche, alerte,
// « À compléter », hausse) — jamais la page ni la taille de page, jamais un paramètre étranger.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("../_rapport/bouton-rapport", () => ({ BoutonRapport: (p: { pdfHref?: string; excelHref?: string }) => h("div", { "data-pdf": p.pdfHref, "data-excel": p.excelHref }) }));

const { ExportInventaire } = await import("./export-inventaire");

afterEach(() => { window.history.replaceState(null, "", "/"); document.body.innerHTML = ""; });
function rendre(domaine?: string) {
  const c = document.createElement("div"); document.body.appendChild(c);
  const r = createRoot(c); act(() => r.render(h(ExportInventaire, { domaine })));
  const el = c.firstElementChild as HTMLElement;
  return { pdf: el.dataset.pdf!, excel: el.dataset.excel! };
}

describe("ExportInventaire", () => {
  it("sans filtre : adresses nues", () => {
    expect(rendre()).toEqual({ pdf: "/stock/catalogue/pdf", excel: "/stock/catalogue/export" });
  });
  it("le filtre affiché (et le domaine) part dans les deux liens ; la page, la taille et le reste non", () => {
    window.history.replaceState(null, "", "/stock/catalogue?q=farine&alerte=URGENT&manque=prix&hausse=1&page=3&par=100&bidon=x");
    const { pdf, excel } = rendre("BOISSON");
    for (const href of [pdf, excel]) {
      const p = new URL(href, "http://x").searchParams;
      expect(Object.fromEntries(p)).toEqual({ q: "farine", alerte: "URGENT", manque: "prix", hausse: "1", domaine: "BOISSON" });
    }
    expect(pdf.startsWith("/stock/catalogue/pdf?")).toBe(true);
    expect(excel.startsWith("/stock/catalogue/export?")).toBe(true);
  });
  it("valeurs inconnues ignorées", () => {
    window.history.replaceState(null, "", "/stock/catalogue?alerte=ROUGE&manque=zzz&hausse=oui");
    expect(rendre().excel).toBe("/stock/catalogue/export");
  });
});
