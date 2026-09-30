import { describe, it, expect } from "vitest";
import type { ResultatDisponibilite } from "@/lib/fiches/disponibilite";
import { resumerDisponibilitePlats } from "./disponibilite-plats";

// Décompte « Plats (disponibilité selon le stock) », partagé par l'Exploitation et le Stock.
const res = (etat: ResultatDisponibilite["etat"], sansRecette = false) =>
  ({ etat, portions: etat === "DISPONIBLE" ? 3 : etat === "RUPTURE" ? 0 : null, limitant: null, enRupture: [], raisons: sansRecette ? [{ motif: "AUCUN_INGREDIENT", ingredient: null }] : [] }) as unknown as ResultatDisponibilite;
const vue = (id: string, type = "PLAT", extra: { actif?: boolean; estSousRecette?: boolean } = {}) => ({ id, type, actif: true, estSousRecette: false, ...extra });

describe("resumerDisponibilitePlats", () => {
  it("plats et fiches Bar comptés à part ; sous-recettes et fiches inactives exclues ; recettes à compléter hors des états", () => {
    const vues = [vue("a"), vue("b"), vue("c"), vue("d"), vue("e"), vue("f", "PLAT", { estSousRecette: true }), vue("g", "PLAT", { actif: false }), vue("h", "BAR"), vue("i", "BAR")];
    const dispos = new Map<string, ResultatDisponibilite>([
      ["a", res("DISPONIBLE")], ["b", res("RUPTURE")], ["c", res("A_VERIFIER")], ["d", res("A_VERIFIER", true)], ["e", res("DISPONIBLE")],
      ["f", res("RUPTURE")], ["g", res("RUPTURE")], ["h", res("DISPONIBLE")], ["i", res("A_VERIFIER", true)],
    ]);
    const r = resumerDisponibilitePlats(vues, dispos);
    expect(r.plats).toEqual({ etats: { DISPONIBLE: 2, RUPTURE: 1, A_VERIFIER: 1 }, recettesACompleter: 1, nbVendues: 5 });
    expect(r.bar).toEqual({ etats: { DISPONIBLE: 1, RUPTURE: 0, A_VERIFIER: 0 }, recettesACompleter: 1, nbVendues: 2 });
  });

  it("aucune fiche : des décomptes vides (0 fiche = 0 plat, un vrai zéro), pas d'erreur", () => {
    const r = resumerDisponibilitePlats([], new Map());
    expect(r.plats.nbVendues).toBe(0);
    expect(r.bar.nbVendues).toBe(0);
  });
});
