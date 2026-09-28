// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableConso } from "./table-conso";
import { consommationsSemaine, sortiesParMotif } from "@/lib/journalier-restaurant";
import type { EntreesStockResto } from "@/lib/stock-restaurant";

// Onglet Consommation : les livraisons au restaurant et les pertes ne se mélangent plus ; la
// consommation réelle du restaurant s'affiche quand un comptage existe, « — » sinon.

const JOURS = [{ iso: "2026-09-21", label: "Lun 21" }, { iso: "2026-09-22", label: "Mar 22" }];
const isos = JOURS.map((j) => j.iso);
const S = (articleId: string, date: string, quantite: number, categorieSortie: string | null) => ({ articleId, designation: articleId, date, quantite, categorieSortie });

const e: EntreesStockResto = {
  articles: [{ id: "f", designation: "Farine resto", espace: "CUISINE", unite: "g", articleStockId: "Farine", uniteCatalogue: "kg" }],
  comptages: [{ articleRestoId: "f", date: "2026-09-20", quantite: "1000" }, { articleRestoId: "f", date: "2026-09-21", quantite: "3500" }],
  livraisons: [{ id: "l", articleStockId: "Farine", designation: "Farine", uniteCatalogue: "kg", date: "2026-09-21", quantite: "2", categorieSortie: "LIVRAISON_RESTAURANT" }],
};

const rendre = () => renderToStaticMarkup(
  <TableConso
    jours={JOURS}
    sorties={sortiesParMotif([S("Farine", "2026-09-21", 2, "LIVRAISON_RESTAURANT"), S("Sucre", "2026-09-22", 0.25, "PERTE")], isos)}
    legumes={[]}
    consoResto={consommationsSemaine(e, isos)}
  />,
);
/** Texte des lignes du tableau, dans l'ordre (sans balises). */
function lignes(html: string): string[] {
  const div = document.createElement("div");
  div.innerHTML = html;
  return [...div.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.textContent?.trim() ?? "").join(" ").replace(/\s+/g, " ").trim());
}

describe("onglet Consommation", () => {
  it("sépare « Livré au restaurant » et « Pertes » en deux sections", () => {
    const l = lignes(rendre());
    const iLivre = l.findIndex((x) => x.startsWith("Livré au restaurant"));
    const iPertes = l.findIndex((x) => x.startsWith("Pertes"));
    expect(iLivre).toBeGreaterThan(-1);
    expect(iPertes).toBeGreaterThan(iLivre);
    expect(l[iLivre + 1]).toMatch(/^Farine 2/);
    expect(l[iPertes + 1]).toMatch(/^Sucre 0,25/);
    // Le total du pied ne compte que les livraisons au restaurant, pas les pertes.
    expect(l.at(-1)).toBe("Total livré au restaurant 2 2");
  });

  it("ajoute la consommation réelle quand un comptage existe ; « — » sinon ; l'écart négatif est signalé", () => {
    const html = rendre();
    const l = lignes(html);
    const iConso = l.findIndex((x) => x.startsWith("Consommation réelle au restaurant"));
    // Lundi : 1000 + 2000 − 3500 = −500 (plus compté que reçu) ; mardi : pas de comptage.
    expect(l[iConso + 1]).toBe("Farine resto (g) -500 écart — —");
    expect(html).toContain("écart : plus compté que reçu");
    expect(html).toContain("pas de comptage ce jour");
  });
});
