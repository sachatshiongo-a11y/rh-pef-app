import { describe, it, expect } from "vitest";
import { bornesNavigation, estMoisPasse, hrefPresences, periodeDuJour, requeteMois, resoudreMoisPresences, resoudreRecherche } from "./presences-mois";

// PRÉSENCES D'UN MOIS PASSÉ — la partie pure : mois demandé, bornes de navigation, adresses.
const OCT = { mois: 10, annee: 2026 };

describe("resoudreMoisPresences — le mois affiché", () => {
  it("sans paramètre : le mois RH courant, pas « passé » (comportement d'avant)", () => {
    expect(resoudreMoisPresences({}, OCT)).toEqual({ ok: true, periode: OCT, passe: false });
  });
  it("un mois antérieur est « passé », y compris d'une autre année", () => {
    expect(resoudreMoisPresences({ mois: "9", annee: "2026" }, OCT)).toEqual({ ok: true, periode: { mois: 9, annee: 2026 }, passe: true });
    expect(resoudreMoisPresences({ mois: "12", annee: "2025" }, OCT)).toMatchObject({ ok: true, passe: true });
  });
  it("le mois courant demandé explicitement n'est pas passé", () => {
    expect(resoudreMoisPresences({ mois: "10", annee: "2026" }, OCT)).toEqual({ ok: true, periode: OCT, passe: false });
  });
  it("un mois à venir est REFUSÉ (jamais remplacé en silence)", () => {
    const r = resoudreMoisPresences({ mois: "11", annee: "2026" }, OCT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/novembre 2026 n'est pas encore ouvert/);
    expect(resoudreMoisPresences({ mois: "1", annee: "2027" }, OCT).ok).toBe(false);
  });
  it("illisible ou incomplet : refus lisible", () => {
    for (const sp of [{ mois: "13", annee: "2026" }, { mois: "abc", annee: "2026" }, { mois: "9" }, { annee: "2026" }, { mois: "", annee: "" }]) {
      const r = resoudreMoisPresences(sp, OCT);
      expect(r.ok, JSON.stringify(sp)).toBe(false);
      expect(!r.ok && r.message).toMatch(/Mois ou année invalide/);
    }
  });
  it("un paramètre répété : la première valeur", () => {
    expect(resoudreMoisPresences({ mois: ["8", "9"], annee: ["2026"] }, OCT)).toMatchObject({ ok: true, periode: { mois: 8, annee: 2026 } });
  });
  it("la même lecture depuis une adresse (route d'export)", () => {
    expect(resoudreRecherche(new URLSearchParams("mois=9&annee=2026"), OCT)).toMatchObject({ ok: true, passe: true });
    expect(resoudreRecherche(new URLSearchParams(""), OCT)).toEqual({ ok: true, periode: OCT, passe: false });
  });
});

describe("bornesNavigation — jusqu'où remonter, jamais au-delà du mois courant", () => {
  it("mois courant : précédent si des données existent avant, jamais de suivant", () => {
    expect(bornesNavigation(OCT, OCT, { mois: 7, annee: 2026 })).toEqual({ prec: { mois: 9, annee: 2026 }, suiv: null });
  });
  it("aucune donnée (ou données seulement à partir du mois courant) : ni précédent ni suivant", () => {
    expect(bornesNavigation(OCT, OCT, null)).toEqual({ prec: null, suiv: null });
    expect(bornesNavigation(OCT, OCT, OCT)).toEqual({ prec: null, suiv: null });
    // des données APRÈS le mois courant (pointage QR d'un jour à venir) ne déplacent pas la borne
    expect(bornesNavigation(OCT, OCT, { mois: 11, annee: 2026 })).toEqual({ prec: null, suiv: null });
  });
  it("au premier mois avec données : plus de précédent ; suivant vers le mois d'après", () => {
    expect(bornesNavigation({ mois: 7, annee: 2026 }, OCT, { mois: 7, annee: 2026 })).toEqual({ prec: null, suiv: { mois: 8, annee: 2026 } });
  });
  it("passage d'année dans les deux sens", () => {
    expect(bornesNavigation({ mois: 1, annee: 2026 }, OCT, { mois: 11, annee: 2025 })).toEqual({ prec: { mois: 12, annee: 2025 }, suiv: { mois: 2, annee: 2026 } });
    expect(bornesNavigation({ mois: 12, annee: 2025 }, { mois: 2, annee: 2026 }, { mois: 1, annee: 2025 })).toEqual({ prec: { mois: 11, annee: 2025 }, suiv: { mois: 1, annee: 2026 } });
  });
  it("le mois juste avant le courant mène au courant", () => {
    expect(bornesNavigation({ mois: 9, annee: 2026 }, OCT, { mois: 1, annee: 2026 }).suiv).toEqual(OCT);
  });
});

describe("hrefPresences — les liens conservent vue, sem, emp", () => {
  it("le mois courant s'écrit sans mois ni année : l'adresse d'aujourd'hui", () => {
    expect(hrefPresences(OCT, OCT)).toBe("/presences");
    expect(hrefPresences(OCT, OCT, { vue: "mois" })).toBe("/presences?vue=mois");
  });
  it("un mois passé porte mois et année, puis la vue en cours", () => {
    expect(hrefPresences({ mois: 9, annee: 2026 }, OCT, { vue: "employe", emp: "e1" })).toBe("/presences?mois=9&annee=2026&vue=employe&emp=e1");
    expect(hrefPresences({ mois: 9, annee: 2026 }, OCT, { vue: "semaine", sem: "2026-09-28" })).toBe("/presences?mois=9&annee=2026&sem=2026-09-28");
  });
  it("la vue Semaine (par défaut) ne s'écrit pas ; les valeurs vides non plus", () => {
    expect(hrefPresences({ mois: 9, annee: 2026 }, OCT, { vue: "semaine", sem: null, emp: null })).toBe("/presences?mois=9&annee=2026");
  });
  it("requeteMois : vide sur le mois courant", () => {
    expect(requeteMois(OCT, OCT)).toBe("");
    expect(requeteMois({ mois: 9, annee: 2026 }, OCT)).toBe("mois=9&annee=2026");
  });
});

describe("periodeDuJour / estMoisPasse", () => {
  it("lit le mois d'un jour saisi ; illisible → null", () => {
    expect(periodeDuJour("2026-09-30")).toEqual({ mois: 9, annee: 2026 });
    expect(periodeDuJour("30/09/2026")).toBeNull();
    expect(periodeDuJour("2026-13-01")).toBeNull();
  });
  it("strictement antérieur", () => {
    expect(estMoisPasse({ mois: 9, annee: 2026 }, OCT)).toBe(true);
    expect(estMoisPasse(OCT, OCT)).toBe(false);
    expect(estMoisPasse({ mois: 11, annee: 2025 }, OCT)).toBe(true);
    expect(estMoisPasse({ mois: 1, annee: 2027 }, OCT)).toBe(false);
  });
});
