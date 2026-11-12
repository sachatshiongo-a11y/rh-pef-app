import { describe, it, expect } from "vitest";
import { controlerDureeCdd, dateFinCdd, lireDureeMois } from "./duree-contrat";
import { controlerDonneesCreation, lignesCreation } from "./creation-fiche-donnees";

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("dateFinCdd : date de fin = embauche + durée, jour de fin inclus", () => {
  it("6 mois depuis le 1er janvier -> 30 juin", () => expect(iso(dateFinCdd("2026-01-01", 6))).toBe("2026-06-30"));
  it("3 mois depuis le 15 mars -> 14 juin", () => expect(iso(dateFinCdd("2026-03-15", 3))).toBe("2026-06-14"));
  it("12 mois franchit l'année", () => expect(iso(dateFinCdd("2026-07-10", 12))).toBe("2027-07-09"));
  it("31 janvier + 1 mois -> fin de février (jour inexistant)", () => expect(iso(dateFinCdd("2026-01-31", 1))).toBe("2026-02-28"));
  it("29 février bissextile + 12 mois -> 28 février", () => expect(iso(dateFinCdd("2028-02-29", 12))).toBe("2029-02-28"));
  it("durée ou date invalide -> null", () => {
    expect(dateFinCdd("n'importe quoi", 6)).toBeNull();
    expect(dateFinCdd("2026-01-01", 0)).toBeNull();
    expect(dateFinCdd("2026-01-01", 1.5)).toBeNull();
  });
});

describe("lireDureeMois / controlerDureeCdd", () => {
  it("lit un entier positif, avec ou sans « mois »", () => {
    expect(lireDureeMois("6")).toBe(6);
    expect(lireDureeMois(" 12 mois ")).toBe(12);
  });
  it("refuse vide, zéro, négatif, décimal, texte", () => {
    for (const v of ["", null, undefined, "0", "-3", "1,5", "abc"]) expect(lireDureeMois(v)).toBeNull();
  });
  it("obligatoire, et plafonnée par les règles", () => {
    expect(controlerDureeCdd(null)).toMatch(/obligatoire/);
    expect(controlerDureeCdd(24)).toBeNull();
    expect(controlerDureeCdd(25)).toMatch(/24 mois/);
    expect(controlerDureeCdd(10, 6)).toMatch(/6 mois/);
  });
});

describe("controlerDonneesCreation : durée du CDD", () => {
  const base = { nom: "Awa", dateEmbauche: "2026-01-01", salaireMensuel: 300, type: "NATIONAL" as const, categorie: "BRIGADE" as const, modePaiement: "ESPECES" as const };
  it("CDD sans durée -> refus", () => expect(controlerDonneesCreation({ ...base, contrat: "CDD" })).toMatch(/durée du CDD/));
  it("CDD trop long -> refus selon le plafond passé", () => expect(controlerDonneesCreation({ ...base, contrat: "CDD", dureeContratMois: 18 }, 12)).toMatch(/12 mois/));
  it("CDD avec durée valide -> accepté", () => expect(controlerDonneesCreation({ ...base, contrat: "CDD", dureeContratMois: 6 })).toBeNull());
  it("CDI : durée non exigée", () => expect(controlerDonneesCreation({ ...base, contrat: "CDI" })).toBeNull());
  it("la demande « À valider » montre la durée et la date de fin", () => {
    const lignes = lignesCreation({ ...base, contrat: "CDD", dureeContratMois: 6, matricule: "" });
    expect(lignes).toContain("Durée du contrat : 6 mois (jusqu'au 30/06/2026)");
  });
});
