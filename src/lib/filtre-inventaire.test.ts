import { describe, it, expect } from "vitest";
import { articleDansFiltre, FILTRE_INVENTAIRE_VIDE, lireFiltreInventaire, paramsFiltreInventaire, type ArticleFiltrable } from "./filtre-inventaire";

const art = (o: Partial<ArticleFiltrable> = {}): ArticleFiltrable => ({
  designation: "Farine T55", code: "137", niveau: "OK", haussePct: null, prix: "2", fournisseurId: "f1", stockMinimum: "5", unite: "Kg", quantite: "10", ...o,
});

describe("filtre de l'inventaire", () => {
  it("lecture des paramètres : valeurs inconnues ignorées", () => {
    const f = lireFiltreInventaire(new URLSearchParams("q=%20farine%20&alerte=URGENT&manque=prix&hausse=1").get.bind(new URLSearchParams("q=%20farine%20&alerte=URGENT&manque=prix&hausse=1")));
    expect(f).toEqual({ q: "farine", alerte: "URGENT", manque: "prix", hausse: true });
    const p = new URLSearchParams("alerte=ROUGE&manque=zzz&hausse=oui");
    expect(lireFiltreInventaire((k) => p.get(k))).toEqual(FILTRE_INVENTAIRE_VIDE);
  });
  it("aller-retour : seuls les filtres actifs vont dans l'adresse", () => {
    expect(paramsFiltreInventaire(FILTRE_INVENTAIRE_VIDE).toString()).toBe("");
    expect(paramsFiltreInventaire({ q: "riz", alerte: "APPRO", manque: "", hausse: true }).toString()).toBe("q=riz&alerte=APPRO&hausse=1");
  });
  it("recherche : sans accent, insensible à la casse, sur le nom OU le code", () => {
    expect(articleDansFiltre(art({ designation: "Crème fraîche" }), { ...FILTRE_INVENTAIRE_VIDE, q: "creme" })).toBe(true);
    expect(articleDansFiltre(art(), { ...FILTRE_INVENTAIRE_VIDE, q: "137" })).toBe(true);
    expect(articleDansFiltre(art(), { ...FILTRE_INVENTAIRE_VIDE, q: "huile" })).toBe(false);
  });
  it("alerte, hausse et « À compléter »", () => {
    expect(articleDansFiltre(art({ niveau: "URGENT" }), { ...FILTRE_INVENTAIRE_VIDE, alerte: "URGENT" })).toBe(true);
    expect(articleDansFiltre(art(), { ...FILTRE_INVENTAIRE_VIDE, alerte: "URGENT" })).toBe(false);
    expect(articleDansFiltre(art({ haussePct: 12 }), { ...FILTRE_INVENTAIRE_VIDE, hausse: true })).toBe(true);
    expect(articleDansFiltre(art(), { ...FILTRE_INVENTAIRE_VIDE, hausse: true })).toBe(false);
    expect(articleDansFiltre(art({ prix: null }), { ...FILTRE_INVENTAIRE_VIDE, manque: "prix" })).toBe(true);
    expect(articleDansFiltre(art({ devisePrix: "CDF", prixCDF: "7000", prix: null }), { ...FILTRE_INVENTAIRE_VIDE, manque: "prix" })).toBe(false);
    expect(articleDansFiltre(art({ quantite: "-2" }), { ...FILTRE_INVENTAIRE_VIDE, manque: "negatif" })).toBe(true);
    expect(articleDansFiltre(art({ fournisseurId: null }), { ...FILTRE_INVENTAIRE_VIDE, manque: "fournisseur" })).toBe(true);
  });
  it("les filtres se cumulent", () => {
    expect(articleDansFiltre(art({ niveau: "URGENT", haussePct: 5 }), { q: "farine", alerte: "URGENT", manque: "", hausse: true })).toBe(true);
    expect(articleDansFiltre(art({ niveau: "URGENT" }), { q: "farine", alerte: "URGENT", manque: "", hausse: true })).toBe(false);
  });
});
