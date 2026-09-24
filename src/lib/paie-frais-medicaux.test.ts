import { describe, it, expect } from "vitest";
import { fraisMedicauxARestituer } from "./paie-frais-medicaux";

// Ce qu'une réouverture restitue à la fiche : ce que la dernière VALIDATION a remis à zéro.
const validation = (deStatut: string, montant: number) => ({ validation: { deStatut, fraisMedicauxFicheRemisAZeroUSD: montant }, employe: { fraisMedicauxMoisCourant: "999" } });
const ancien = (fiche: string) => ({ employe: { fraisMedicauxMoisCourant: fiche } });

describe("fraisMedicauxARestituer", () => {
  it("dernière validation depuis PAS_VALIDE : son montant, jamais la fiche de l'instantané", () => {
    expect(fraisMedicauxARestituer([validation("PAS_VALIDE", 30)], ["PAS_VALIDE"])).toBe(30);
  });
  it("annulations de paiement sautées : la validation d'avant fait foi", () => {
    expect(fraisMedicauxARestituer([validation("PAYE", 0), validation("PAYE", 0), validation("PAS_VALIDE", 12.5)], ["PAS_VALIDE", "PAYE", "PAYE"])).toBe(12.5);
  });
  it("rien de remis à zéro : 0", () => {
    expect(fraisMedicauxARestituer([validation("PAS_VALIDE", 0)], ["PAS_VALIDE"])).toBe(0);
    expect(fraisMedicauxARestituer([], [])).toBe(0);
  });
  it("ligne validée avant la règle, sans annulation de paiement : la fiche d'avant la remise à zéro", () => {
    expect(fraisMedicauxARestituer([ancien("25"), ancien("0")], ["PAS_VALIDE", "PAS_VALIDE"])).toBe(25);
  });
  it("ligne validée avant la règle, avec une annulation de paiement : 0 plutôt qu'un montant deviné", () => {
    expect(fraisMedicauxARestituer([ancien("25")], ["PAS_VALIDE", "PAYE"])).toBe(0);
  });
  it("nouvelle validation après d'anciennes : la nouvelle fait foi", () => {
    expect(fraisMedicauxARestituer([validation("PAS_VALIDE", 8), ancien("25")], ["PAS_VALIDE", "PAYE", "PAS_VALIDE"])).toBe(8);
  });
});
