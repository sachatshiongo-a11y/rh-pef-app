import { describe, it, expect } from "vitest";
import { verifierProlongationCdd, verifierProlongationEssai, typeSansConges, REGLES_DEFAUT } from "./regles-contrats";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("verifierProlongationCdd — garde-fous légaux (défauts à valider)", () => {
  const base = { dateDebut: d("2026-01-01"), dateFin: d("2026-06-30"), renouvellements: 0 };

  it("autorise une première prolongation raisonnable", () => {
    expect(verifierProlongationCdd(base, d("2026-12-31"), REGLES_DEFAUT)).toBeNull();
  });

  it("refuse une date antérieure à la fin actuelle", () => {
    expect(verifierProlongationCdd(base, d("2026-06-01"), REGLES_DEFAUT)).toMatch(/postérieure/);
  });

  it("refuse au-delà du nombre maximum de renouvellements", () => {
    const use = { ...base, renouvellements: REGLES_DEFAUT.cddRenouvellementsMax };
    expect(verifierProlongationCdd(use, d("2026-12-31"), REGLES_DEFAUT)).toMatch(/prolongé.*fois/);
  });

  it("refuse au-delà de la durée totale maximale", () => {
    // Début janvier 2026 → fin 2028 = ~36 mois > 24.
    expect(verifierProlongationCdd(base, d("2028-12-31"), REGLES_DEFAUT)).toMatch(/mois au total/);
  });
});

describe("verifierProlongationEssai — durée maximale", () => {
  const contrat = { dateDebut: d("2026-01-01"), finPeriodeEssai: d("2026-03-31") };

  it("autorise une prolongation sous le plafond", () => {
    expect(verifierProlongationEssai(contrat, d("2026-05-31"), REGLES_DEFAUT)).toBeNull();
  });

  it("refuse une date antérieure à la fin d'essai actuelle", () => {
    expect(verifierProlongationEssai(contrat, d("2026-02-01"), REGLES_DEFAUT)).toMatch(/postérieure/);
  });

  it("refuse au-delà de la durée maximale d'essai", () => {
    expect(verifierProlongationEssai(contrat, d("2026-09-30"), REGLES_DEFAUT)).toMatch(/maximum/);
  });
});

describe("typeSansConges", () => {
  it("stagiaires et intérimaires n'acquièrent pas de congés ; les autres si", () => {
    expect(typeSansConges("STAGE")).toBe(true);
    expect(typeSansConges("INTERIM")).toBe(true);
    expect(typeSansConges("CDD")).toBe(false);
    expect(typeSansConges("CDI")).toBe(false);
    expect(typeSansConges(null)).toBe(false);
  });
});
