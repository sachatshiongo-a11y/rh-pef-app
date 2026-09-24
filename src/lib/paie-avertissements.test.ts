import { describe, it, expect } from "vitest";
import { avertissementCddEchu, detecterAvertissementsSaisie, lireAvertissements, type JourSaisie } from "./paie-avertissements";

const j = (iso: string, e: Partial<JourSaisie> = {}): JourSaisie => ({
  date: new Date(`${iso}T00:00:00Z`), code: "P", codeSaisiLe: new Date(`${iso}T18:00:00Z`), heuresFaites: 8,
  heuresSaisiesLe: new Date(`${iso}T18:00:00Z`), heuresModifieesLe: new Date(`${iso}T18:00:00Z`),
  heuresPlanifiees: 8, creneauModifieLe: new Date("2026-09-01T08:00:00Z"), ...e,
});
// Saisie en lot RÉELLE du 22/09/2026 à 12:52 (UTC) — Jeannette Bongota, Rachel Lunda.
const LOT = new Date("2026-09-22T12:52:22Z");

describe("detecterAvertissementsSaisie", () => {
  it("rien à signaler sur des saisies du jour même", () => {
    expect(detecterAvertissementsSaisie([j("2026-09-21"), j("2026-09-22")], { referencePlanning: true })).toEqual([]);
  });

  it("présences et heures saisies avant le jour concerné → SAISIE_ANTICIPEE, avec les dates", () => {
    const jours = ["2026-09-22", "2026-09-24", "2026-09-25"].map((d) => j(d, { codeSaisiLe: LOT, heuresSaisiesLe: LOT, heuresModifieesLe: LOT }));
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: false })).toEqual([
      { code: "SAISIE_ANTICIPEE", message: "Saisi d'avance (2 j) : 24/09, 25/09" },
    ]);
  });

  it("le jour se lit à l'heure de Kinshasa : 23:30 UTC le 21 = le 22 à Kinshasa → pas d'avance pour le 22", () => {
    const tard = new Date("2026-09-21T23:30:00Z");
    expect(detecterAvertissementsSaisie([j("2026-09-22", { codeSaisiLe: tard, heuresSaisiesLe: tard, heuresModifieesLe: tard })], { referencePlanning: false })).toEqual([]);
  });

  it("jour codé P sans créneau (Rachel, 28 et 30/09) → PRESENCE_SANS_CRENEAU, seulement sous la règle planning", () => {
    const jours = [j("2026-09-28", { heuresPlanifiees: 0, creneauModifieLe: null }), j("2026-09-30", { heuresPlanifiees: 0, creneauModifieLe: null })];
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: true })).toEqual([
      { code: "PRESENCE_SANS_CRENEAU", message: "Travail hors planning (2 j) : 28/09, 30/09" },
    ]);
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: false })).toEqual([]);
  });

  it("jour codé P avec créneau mais SANS heures saisies (17/09) → PRESENCE_SANS_HEURES, seulement sous la règle planning", () => {
    // Décision du contrôleur : le créneau planifié gonfle déjà la référence R (via hsPlan dans
    // calculerReferenceMois), mais le jour n'est payé nulle part faute d'heures saisies — retenue
    // silencieuse sur un salaire censé être complet.
    const jours = [j("2026-09-17", { heuresFaites: 0 })];
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: true })).toEqual([
      { code: "PRESENCE_SANS_HEURES", message: "Présent sans heures saisies : jour retenu (1 j) : 17/09" },
    ]);
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: false })).toEqual([]);
  });

  it("créneau modifié APRÈS les heures et heures différentes (Jeannette, 21/09) → PLANNING_MODIFIE_APRES_HEURES", () => {
    const jours = [
      j("2026-09-21", { heuresPlanifiees: 8, heuresFaites: 6, heuresSaisiesLe: new Date("2026-09-21T18:00:00Z"), heuresModifieesLe: new Date("2026-09-21T18:00:00Z"), creneauModifieLe: new Date("2026-09-22T15:09:11Z") }),
      j("2026-09-23", { heuresPlanifiees: 8, heuresFaites: 8, creneauModifieLe: new Date("2026-09-24T15:00:00Z") }), // mêmes heures : rien
    ];
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: true })).toEqual([
      { code: "PLANNING_MODIFIE_APRES_HEURES", message: "Planning modifié après la saisie des heures (1 j) : 21/09" },
    ]);
  });
});

describe("lireAvertissements", () => {
  it("relit un tableau JSON bien formé et ignore le reste", () => {
    const ok = { code: "REPLI_CONTRAT", message: "Heures contrat (repli) — x" };
    const okPresenceSansHeures = { code: "PRESENCE_SANS_HEURES", message: "Présent sans heures saisies : jour retenu (1 j) : 17/09" };
    expect(lireAvertissements([ok, okPresenceSansHeures, { code: "INCONNU", message: "?" }, { code: "SAISIE_ANTICIPEE" }, null, 3])).toEqual([ok, okPresenceSansHeures]);
    expect(lireAvertissements(null)).toEqual([]);
    expect(lireAvertissements({})).toEqual([]);
  });
});

describe("avertissementCddEchu", () => {
  it("CDD échu le 01/09 et poursuivi (Myriam Bumbakini) → message daté, relu par lireAvertissements", () => {
    const a = avertissementCddEchu(new Date("2026-09-01T00:00:00Z"));
    expect(a).toEqual([
      { code: "CDD_ECHU_POURSUIVI", message: "CDD échu le 01/09/2026 sans renouvellement enregistré : le salarié a continué à travailler." },
    ]);
    // La colonne JSON le relit : un code absent de CODES disparaîtrait de l'écran sans bruit.
    expect(lireAvertissements(a)).toEqual(a);
  });
  it("pas de fin ignorée → aucun avertissement", () => {
    expect(avertissementCddEchu(null)).toEqual([]);
  });
});
