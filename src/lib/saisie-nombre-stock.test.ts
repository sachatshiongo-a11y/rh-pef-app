import { describe, it, expect } from "vitest";
import { canoniqueVersSaisie, nombreDeBase, nombreDeSaisie } from "./saisie-nombre-stock";
import { vueDepuisSaisie, vueEnSaisie, type FicheVue } from "@/app/(stock)/stock/fiches/_data/fiche-calc";

describe("passerelle base ⇄ saisie des écrans Stock", () => {
  it("un Decimal de la base s'écrit à la française, sans jamais devenir un autre nombre", () => {
    expect(canoniqueVersSaisie("2.125")).toBe("2,125");
    expect(canoniqueVersSaisie("1250")).toBe("1250");
    expect(canoniqueVersSaisie(2.5)).toBe("2,5");
    expect(canoniqueVersSaisie(null)).toBe("");
    expect(canoniqueVersSaisie("")).toBe("");
  });

  it("un texte de saisie se relit à la française ; illisible ou vide = 0 (totaux affichés seulement)", () => {
    expect(nombreDeSaisie("2,5")).toBe(2.5);
    expect(nombreDeSaisie("1 250,5")).toBe(1250.5);
    expect(nombreDeSaisie("150.000")).toBe(150000);
    expect(nombreDeSaisie("2.5")).toBe(0); // illisible : la case le signale, le total ne l'invente pas
    expect(nombreDeSaisie("")).toBe(0);
  });

  it("une valeur de la base pré-remplit une case telle quelle : « 2.125 » reste 2,125 (jamais 2125)", () => {
    expect(nombreDeBase("2.125")).toBe(2.125);
    expect(nombreDeBase("")).toBeNull();
    expect(nombreDeBase(undefined)).toBeNull();
  });
});

describe("fiche technique : saisie ⇄ notation canonique des moteurs", () => {
  const vue: FicheVue = {
    id: "f", nom: "Mojito", categorie: "", type: "BAR", nbPortions: 1, tauxTVA: "0.16", prixVenteTTC: "12.5",
    coefficientMargeCible: "", estSousRecette: false, rendementQuantite: "", rendementUnite: "", recette: "", actif: true, photoUrl: null,
    lignes: [{ id: "l1", articleId: "a", sousFicheId: null, unite: "cl", quantite: "2.125", ordre: 1 }],
  };

  it("l'écran affiche à la française, les moteurs reçoivent la notation à point", () => {
    const s = vueEnSaisie(vue);
    expect([s.tauxTVA, s.prixVenteTTC, s.lignes[0].quantite, s.nbPortions]).toEqual(["0,16", "12,5", "2,125", "1"]);
    expect(vueDepuisSaisie(s)).toEqual(vue);
  });

  it("une saisie illisible n'est jamais lue comme un nombre : « 2.5 » part « illisible » vers le moteur", () => {
    const s = vueEnSaisie(vue);
    const v = vueDepuisSaisie({ ...s, lignes: [{ ...s.lignes[0], quantite: "2.5" }], nbPortions: "2,5" });
    expect(v.lignes[0].quantite).toBe("illisible");
    expect(Number.isNaN(v.nbPortions)).toBe(true); // portions non entières : inexploitables, jamais arrondies
  });
});
