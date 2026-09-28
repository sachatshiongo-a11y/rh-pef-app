import { describe, it, expect } from "vitest";
import { sortiesSontLivraisons, categorieSortieImport, MOTIF_LIVRAISON_RESTAURANT } from "./motif-sorties-import";

// Décision Direction (2026-09-28) : les sorties importées (CSV de mouvements, classeur d'inventaire)
// reçoivent par défaut le motif « Livraison restaurant ». Case décochée → aucun motif.
describe("sortiesSontLivraisons — lecture du choix envoyé par l'écran d'import", () => {
  it("absent → OUI (le défaut de la Direction)", () => {
    expect(sortiesSontLivraisons(null)).toBe(true);
    expect(sortiesSontLivraisons(undefined)).toBe(true);
  });
  it("« 1 » → oui ; « 0 » → non", () => {
    expect(sortiesSontLivraisons("1")).toBe(true);
    expect(sortiesSontLivraisons("0")).toBe(false);
  });
});

describe("categorieSortieImport", () => {
  it("une SORTIE reçoit « LIVRAISON_RESTAURANT » quand la case est cochée", () => {
    expect(MOTIF_LIVRAISON_RESTAURANT).toBe("LIVRAISON_RESTAURANT");
    expect(categorieSortieImport("SORTIE", true)).toBe("LIVRAISON_RESTAURANT");
  });
  it("case décochée → aucun motif", () => {
    expect(categorieSortieImport("SORTIE", false)).toBeNull();
  });
  it("une ENTRÉE n'a jamais de motif de sortie", () => {
    expect(categorieSortieImport("ENTREE", true)).toBeNull();
    expect(categorieSortieImport("ENTREE", false)).toBeNull();
  });
});
