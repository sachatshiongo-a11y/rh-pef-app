// @vitest-environment happy-dom
//
// Grille du restaurant : le « Reçu du dépôt » s'affiche à côté du comptage, EN LECTURE SEULE (le
// comptage reste la seule saisie, par la case partagée `CelluleNombre`) ; la colonne « Stock
// théorique » montre l'état courant, « — » quand il est inconnu, et ses signalements.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Jour, LigneResto } from "./restaurant-client";

vi.mock("./actions", () => ({
  majComptage: vi.fn(async () => undefined), modifierArticleResto: vi.fn(async () => undefined),
  creerArticleResto: vi.fn(async () => undefined), supprimerArticleResto: vi.fn(async () => undefined),
  rattacherArticleResto: vi.fn(async () => ({ n: 0 })),
}));

const { RestaurantGrille } = await import("./restaurant-client");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOURS: Jour[] = [
  { iso: "2026-09-21", label: "Lun", num: "21 sept." },
  { iso: "2026-09-22", label: "Mar", num: "22 sept." },
];
const ligne = (p: Partial<LigneResto> & { id: string; designation: string }): LigneResto => ({
  categorie: null, unite: "g", base: "", comptages: {}, articleStockId: null, articleStockDesignation: null,
  recus: {}, signauxJour: {}, theorique: { stock: null, aucunComptage: true, signalements: [] }, ...p,
});

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function monter(lignes: LigneResto[]) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(RestaurantGrille, { espace: "CUISINE", jours: JOURS, lignes, categories: [], estDirection: false, catalogue: [] })));
}
const rangee = (designation: string) => [...conteneur.querySelectorAll("tbody tr")].find((tr) => (tr.querySelector("input") as HTMLInputElement | null)?.value === designation)!;

describe("grille du restaurant — reçu du dépôt et stock théorique", () => {
  it("le reçu du dépôt s'affiche à côté du comptage, en lecture seule", () => {
    monter([
      ligne({
        id: "farine", designation: "Farine", comptages: { "2026-09-22": "900" }, articleStockId: "cat", articleStockDesignation: "Farine",
        recus: { "2026-09-21": "2000" }, theorique: { stock: "900", aucunComptage: false, signalements: [] },
      }),
    ]);
    const tr = rangee("Farine");
    const recu = tr.querySelector('[aria-label="Reçu du dépôt — Farine — Lun 21 sept."]')!;
    expect(recu).not.toBeNull();
    expect(recu.textContent).toContain("2 000");
    expect(recu.tagName).not.toBe("INPUT");
    expect(recu.querySelector("input")).toBeNull();
    // Aucun reçu le mardi : rien n'est affiché (pas de 0 inventé).
    expect(tr.querySelector('[aria-label="Reçu du dépôt — Farine — Mar 22 sept."]')).toBeNull();
    // Saisies : désignation, unité, stock de base et un comptage par jour — rien de plus.
    expect(tr.querySelectorAll("input").length).toBe(3 + JOURS.length);
    expect(conteneur.textContent).toContain("Reçu du dépôt");
  });

  it("colonne « Stock théorique » : valeur, « — » si inconnue, mention sans comptage, signalements", () => {
    monter([
      ligne({ id: "a", designation: "Farine", theorique: { stock: "3500", aucunComptage: false, signalements: [] } }),
      ligne({ id: "b", designation: "Sel" }),
      ligne({ id: "c", designation: "Tomate", theorique: { stock: "2000", aucunComptage: true, signalements: [] } }),
      ligne({ id: "d", designation: "Citron", unite: "pièce", theorique: { stock: "10", aucunComptage: false, signalements: ["12 pièce du 22/09 à répartir"] } }),
    ]);
    expect([...conteneur.querySelectorAll("thead th")].some((th) => th.textContent?.includes("Stock théorique"))).toBe(true);
    const cellule = (d: string) => rangee(d).querySelector('[data-colonne="stock-theorique"]')!;
    expect(cellule("Farine").textContent).toContain("3 500 g");
    expect(cellule("Sel").textContent?.trim()).toBe("—");
    expect(cellule("Tomate").textContent).toContain("estimé");
    expect(cellule("Tomate").getAttribute("title") ?? cellule("Tomate").innerHTML).toContain("aucun comptage : stock estimé à partir des seules livraisons");
    expect(cellule("Citron").textContent).toContain("12 pièce du 22/09 à répartir");
  });

  it("deux signalements identiques (deux livraisons de 12 pièces le même jour) : pas de clé React en double", () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    monter([ligne({
      id: "d", designation: "Citron", unite: "pièce",
      signauxJour: { "2026-09-21": ["12 pièce : à répartir", "12 pièce : à répartir"] },
      theorique: { stock: "10", aucunComptage: false, signalements: ["12 pièce du 21/09 : à répartir", "12 pièce du 21/09 : à répartir"] },
    })]);
    expect(erreurs.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    expect(conteneur.textContent!.split("12 pièce du 21/09 : à répartir").length - 1).toBe(2);
    erreurs.mockRestore();
  });
});
