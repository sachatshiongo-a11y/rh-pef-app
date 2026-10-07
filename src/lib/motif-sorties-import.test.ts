import { describe, it, expect } from "vitest";
import { sortiesSontLivraisons, categorieSortieImport, MOTIF_LIVRAISON_RESTAURANT } from "./motif-sorties-import";

// Décision Direction (2026-09-28) : les sorties importées (CSV de mouvements, classeur d'inventaire)
// reçoivent le motif « Livraison restaurant ». Depuis le 2026-10-07, le motif est OBLIGATOIRE : une
// demande « sans motif » (ancien écran) est refusée pour toute sortie.
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
  it("« sans motif » demandé (ancien écran) → refus lisible, jamais une sortie sans motif", () => {
    expect(() => categorieSortieImport("SORTIE", false)).toThrow(/motif est obligatoire/);
  });
  it("une ENTRÉE n'a jamais de motif de sortie", () => {
    expect(categorieSortieImport("ENTREE", true)).toBeNull();
    expect(categorieSortieImport("ENTREE", false)).toBeNull();
    expect(categorieSortieImport("AJUSTEMENT", false)).toBeNull();
  });
});
