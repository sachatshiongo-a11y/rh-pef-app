import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { appliquerReception, exigerBonReceptionnable, lireQuantitesRecues, quantiteRecueAffichee, resteARecevoir } from "./reception-bc";

const L = (id: string, quantite: string, quantiteRecue: string | null = null) => ({ id, designation: `Ligne ${id}`, quantite, quantiteRecue });

describe("réceptions partielles — le statut se calcule sur le cumul par ligne", () => {
  it("une réception partielle laisse le bon « Reçu partiel » et dit ce qui reste", () => {
    const r = appliquerReception([L("a", "10"), L("b", "4")], new Map([["a", new Decimal(6)]]));
    expect(r.complet).toBe(false);
    expect(r.maj).toEqual([{ id: "a", quantiteRecue: "6" }]);
    expect(r.restes).toEqual([{ id: "a", designation: "Ligne a", reste: "4" }, { id: "b", designation: "Ligne b", reste: "4" }]);
  });
  it("les réceptions s'ADDITIONNENT : la seconde complète la première et le bon devient « Reçu »", () => {
    const apres1 = appliquerReception([L("a", "10")], new Map([["a", new Decimal(6)]]));
    const apres2 = appliquerReception([L("a", "10", apres1.maj[0].quantiteRecue)], new Map([["a", new Decimal(4)]]));
    expect(apres2.maj[0].quantiteRecue).toBe("10");
    expect(apres2.complet).toBe(true);
    expect(apres2.restes).toEqual([]);
  });
  it("une LIGNE LIBRE (sans article) compte comme les autres : tout reçu = bon complet", () => {
    // Le calcul ne regarde jamais l'article : seule la quantité compte.
    const r = appliquerReception([L("libre", "3"), L("art", "2")], new Map([["libre", new Decimal(3)], ["art", new Decimal(2)]]));
    expect(r.complet).toBe(true);
  });
  it("un surplus reçu n'empêche pas le bon d'être complet ; les décimales restent exactes", () => {
    expect(appliquerReception([L("a", "2.125")], new Map([["a", new Decimal("2.2")]])).complet).toBe(true);
    expect(appliquerReception([L("a", "0.3", "0.1")], new Map([["a", new Decimal("0.2")]])).complet).toBe(true); // 0,1 + 0,2 = 0,3 exactement
  });
  it("un bon sans ligne n'est jamais « complet »", () => {
    expect(appliquerReception([], new Map()).complet).toBe(false);
  });
});

describe("lireQuantitesRecues — saisie validée", () => {
  const lignes = [{ id: "a", designation: "Farine" }, { id: "b", designation: "Sel" }];
  it("écarte les zéros, additionne les doublons", () => {
    const r = lireQuantitesRecues(["a", "b", "a"], [2, 0, 1], lignes);
    expect([...r.entries()].map(([k, v]) => [k, v.toString()])).toEqual([["a", "3"]]);
  });
  it("refuse : rien reçu, négatif, 4 décimales, ligne inconnue", () => {
    expect(() => lireQuantitesRecues(["a"], [0], lignes)).toThrow(/au moins une quantité reçue/);
    expect(() => lireQuantitesRecues(["a"], [-1], lignes)).toThrow(/négative pour « Farine »/);
    expect(() => lireQuantitesRecues(["a"], [1.2345], lignes)).toThrow(/3 décimales/);
    expect(() => lireQuantitesRecues(["zzz"], [1], lignes)).toThrow(/Ligne inconnue/);
  });
});

describe("exigerBonReceptionnable", () => {
  it("refuse brouillon, annulé et déjà reçu ; accepte validé, envoyé, reçu partiel", () => {
    expect(() => exigerBonReceptionnable("BROUILLON")).toThrow(/brouillon/);
    expect(() => exigerBonReceptionnable("ANNULE")).toThrow(/annulé/);
    expect(() => exigerBonReceptionnable("RECU")).toThrow(/déjà reçu/);
    for (const ok of ["VALIDE", "ENVOYE", "RECU_PARTIEL"]) expect(() => exigerBonReceptionnable(ok)).not.toThrow();
  });
});

describe("affichage reçu / commandé", () => {
  it("quantité non enregistrée : « Reçu » vaut tout, sinon inconnue (jamais 0 deviné)", () => {
    expect(quantiteRecueAffichee("RECU", { quantite: "5", quantiteRecue: null })).toBe(5);
    expect(quantiteRecueAffichee("RECU_PARTIEL", { quantite: "5", quantiteRecue: null })).toBeNull();
    expect(quantiteRecueAffichee("RECU_PARTIEL", { quantite: "5", quantiteRecue: "2" })).toBe(2);
    expect(quantiteRecueAffichee("RECU_PARTIEL", { quantite: "5", quantiteRecue: "0" })).toBe(0);
  });
  it("reste à recevoir jamais négatif", () => {
    expect(resteARecevoir("10", "6")).toBe("4");
    expect(resteARecevoir("10", "12")).toBe("0");
    expect(resteARecevoir("10", null)).toBe("10");
  });
});
