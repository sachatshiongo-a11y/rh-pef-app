import { describe, expect, it } from "vitest";
import {
  ageEnAnnees,
  compterFamille,
  ecartCompositionFamiliale,
  type MembreFamilleLu,
} from "@/lib/famille";

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");
const enfant = (nom: string, naissance: string | null): MembreFamilleLu => ({
  lien: "ENFANT", nom, dateNaissance: naissance ? d(naissance) : null,
});

describe("ageEnAnnees", () => {
  it("compte des années RÉVOLUES, pas une différence d'années civiles", () => {
    // Né le 3 septembre 2008 : 17 ans le 1er septembre 2026, 18 ans seulement le 3.
    expect(ageEnAnnees(d("2008-09-03"), d("2026-09-01"))).toBe(17);
    expect(ageEnAnnees(d("2008-09-03"), d("2026-09-02"))).toBe(17);
    expect(ageEnAnnees(d("2008-09-03"), d("2026-09-03"))).toBe(18);
  });

  it("gère le changement de mois", () => {
    expect(ageEnAnnees(d("2008-12-31"), d("2026-01-01"))).toBe(17);
    expect(ageEnAnnees(d("2008-01-01"), d("2026-12-31"))).toBe(18);
  });

  it("ne renvoie jamais de valeur négative", () => {
    expect(ageEnAnnees(d("2030-01-01"), d("2026-01-01"))).toBe(0);
  });
});

describe("compterFamille", () => {
  const ref = d("2026-08-16");

  it("compte à charge les enfants sous l'âge limite", () => {
    const c = compterFamille(
      [enfant("Grace", "2015-04-02"), enfant("Josué", "2020-11-30")],
      ref,
      18
    );
    expect(c.enfantsACharge).toBe(2);
    expect(c.enfantsTotal).toBe(2);
  });

  it("exclut un enfant qui a dépassé l'âge limite", () => {
    const c = compterFamille([enfant("Aîné", "2005-01-10"), enfant("Cadet", "2018-06-01")], ref, 18);
    expect(c.enfantsACharge).toBe(1);
    expect(c.enfantsTotal).toBe(2);
  });

  it("ne compte JAMAIS à charge un enfant sans date de naissance, mais le signale", () => {
    const c = compterFamille([enfant("Sans date", null), enfant("Grace", "2015-04-02")], ref, 18);
    expect(c.enfantsACharge).toBe(1);
    expect(c.enfantsSansDate).toBe(1);
    expect(c.enfantsTotal).toBe(2);
  });

  it("isole le conjoint des enfants", () => {
    const c = compterFamille(
      [{ lien: "CONJOINT", nom: "Marie", dateNaissance: d("1990-02-02") }, enfant("Grace", "2015-04-02")],
      ref,
      18
    );
    expect(c.conjoint).toBe("Marie");
    expect(c.enfantsTotal).toBe(1);
  });

  it("respecte un âge limite différent de 18 (paramètre À VALIDER)", () => {
    const membres = [enfant("Étudiant", "2004-03-01")];
    expect(compterFamille(membres, ref, 18).enfantsACharge).toBe(0);
    expect(compterFamille(membres, ref, 25).enfantsACharge).toBe(1);
  });

  it("renvoie des compteurs à zéro sur une fiche vide", () => {
    const c = compterFamille([], ref, 18);
    expect(c).toEqual({ enfantsACharge: 0, enfantsTotal: 0, enfantsSansDate: 0, conjoint: null });
  });
});

describe("ecartCompositionFamiliale", () => {
  const ref = d("2026-08-16");
  const comptage = (membres: MembreFamilleLu[]) => compterFamille(membres, ref, 18);

  it("ne signale rien quand le compteur et la fiche concordent", () => {
    const c = comptage([enfant("Grace", "2015-04-02"), enfant("Josué", "2020-11-30")]);
    expect(ecartCompositionFamiliale(2, c)).toBeNull();
  });

  it("ne signale rien sur une fiche vide — non renseigné n'est pas zéro", () => {
    expect(ecartCompositionFamiliale(3, comptage([]))).toBeNull();
  });

  it("signale un enfant devenu majeur sans toucher au calcul", () => {
    const c = comptage([enfant("Aîné", "2005-01-10"), enfant("Cadet", "2018-06-01")]);
    const e = ecartCompositionFamiliale(2, c);
    expect(e).not.toBeNull();
    expect(e?.compteurPaie).toBe(2);
    expect(e?.deduitDesDates).toBe(1);
    expect(e?.message).toContain("n'a pas été modifié");
  });

  it("signale les enfants sans date de naissance même si le nombre à charge coïncide", () => {
    const c = comptage([enfant("Grace", "2015-04-02"), enfant("Sans date", null)]);
    const e = ecartCompositionFamiliale(1, c);
    expect(e).not.toBeNull();
    expect(e?.message).toContain("sans date de naissance");
  });

  it("signale aussi le cas inverse : plus d'enfants à charge que le compteur", () => {
    const c = comptage([enfant("Grace", "2015-04-02"), enfant("Josué", "2020-11-30")]);
    const e = ecartCompositionFamiliale(0, c);
    expect(e).not.toBeNull();
    expect(e?.deduitDesDates).toBe(2);
  });
});
