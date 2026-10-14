import { describe, it, expect } from "vitest";
import { apercuUnite, classerChangementUnite, type FaitsUnite } from "./unite-article";

// Changer l'unité d'un article ne convertit RIEN : ce module dit, article par article, ce qui change de sens.
// Pur (aucune base) : les faits sont donnés, la classification est vérifiée.

const vierge = (o: Partial<FaitsUnite> = {}): FaitsUnite => ({
  id: "a", designation: "Farine", nom: "Farine", unite: "kg", contenance: null, contenanceUnite: null, uniteParCarton: null,
  stock: "0", stockEndommage: "0", prix: null,
  nbMouvements: 0, nbLignesFacture: 0, nbLignesBon: 0, nbCommandesResto: 0, nbComptages: 0, fiches: [], liens: [], ...o,
});
const un = (faits: FaitsUnite, unite: string) => classerChangementUnite([faits], unite)[0];

describe("classerChangementUnite — la règle, article par article", () => {
  it("sans stock ni historique ni prix ni fiche ni rattachement : changement LIBRE, rien à confirmer", () => {
    const l = un(vierge(), "g");
    expect(l).toMatchObject({ nature: "LIBRE", avant: "kg", apres: "g", confirmer: false, raisons: [], alertes: [] });
  });

  it("même unité, ou même unité à l'orthographe près : aucun risque, même avec du stock", () => {
    expect(un(vierge({ stock: "12" }), "kg").nature).toBe("INCHANGE");
    const o = un(vierge({ unite: "Kg", stock: "12", nbMouvements: 40 }), "kg");
    expect(o).toMatchObject({ nature: "ORTHOGRAPHE", confirmer: false });
    expect(un(vierge({ unite: "Pièces", stock: "3" }), "pièce").nature).toBe("ORTHOGRAPHE");
  });

  it("stock, mouvements, prix : à RISQUE, et la ligne les nomme avec les chiffres qui restent", () => {
    const l = un(vierge({ stock: "12", nbMouvements: 40, prix: "2,50 $", nbLignesFacture: 3 }), "g");
    expect(l.nature).toBe("A_RISQUE");
    expect(l.confirmer).toBe(true);
    expect(l.raisons).toEqual(["stock 12 kg", "40 mouvements", "prix de référence 2,50 $", "3 lignes de facture"]);
  });

  it.each([
    ["un seul mouvement", { nbMouvements: 1 }],
    ["un prix", { prix: "7 000 FC" }],
    ["une ligne de bon de commande", { nbLignesBon: 1 }],
    ["une commande du restaurant", { nbCommandesResto: 1 }],
    ["un comptage", { nbComptages: 1 }],
    ["une fiche technique", { fiches: [{ fiche: "Pâte", unite: "g" }] }],
    ["un rattachement au restaurant", { liens: [{ restoDesignation: "Farine", espace: "CUISINE" as const, restoUnite: null }] }],
    ["du stock endommagé", { stockEndommage: "2" }],
  ])("%s suffit pour exiger la confirmation", (_nom, o) => {
    expect(un(vierge(o), "g")).toMatchObject({ nature: "A_RISQUE", confirmer: true });
  });

  it("article SANS unité jusqu'ici : l'unité se POSE, rien à confirmer même avec du stock", () => {
    const l = un(vierge({ unite: null, stock: "12", nbMouvements: 40 }), "kg");
    expect(l).toMatchObject({ nature: "POSEE", avant: null, confirmer: false, raisons: [] });
    expect(un(vierge({ unite: "  " }), "kg").nature).toBe("POSEE");
  });

  it("restaurant : une unité qui rend les livraisons inconvertibles est annoncée", () => {
    const f = vierge({ liens: [{ restoDesignation: "Farine", espace: "CUISINE", restoUnite: "kg" }] });
    const l = un(f, "Sac"); // kg ↔ sac : aucune conversion
    expect(l.confirmer).toBe(true);
    expect(l.alertes.join(" ")).toMatch(/Rattaché à « Farine » \(Cuisine, compté en kg\).*unités incompatibles.*n'alimenteront plus le stock du restaurant/);
  });

  it("restaurant : kg → g garde des unités convertibles mais change le facteur ET l'écart d'unité est annoncé", () => {
    const f = vierge({ liens: [{ restoDesignation: "Farine", espace: "CUISINE", restoUnite: "kg" }] });
    const a = un(f, "g").alertes.join(" ");
    expect(a).toContain("relues dans la nouvelle unité");
    expect(a).toContain("1 kg = 1 kg avant, 1 g = 0,001 kg après");
    expect(a).toContain("le stock du restaurant change");
    expect(a).toContain("une seule unité par produit : le restaurant compte en kg, l'Inventaire en g");
  });

  it("restaurant : poser l'unité d'un article rattaché fait compter ses livraisons jusqu'ici ignorées", () => {
    const f = vierge({ unite: null, liens: [{ restoDesignation: "Farine", espace: "CUISINE", restoUnite: "kg" }] });
    const l = un(f, "kg");
    expect(l.nature).toBe("POSEE");
    expect(l.confirmer).toBe(true); // l'effet sur le restaurant mérite d'être lu
    expect(l.alertes.join(" ")).toContain("jusqu'ici ignorées faute d'unité");
  });

  it("restaurant : un article du restaurant sans unité ne génère pas d'alerte de plus (déjà signalé à son écran)", () => {
    const f = vierge({ liens: [{ restoDesignation: "Farine", espace: "BAR", restoUnite: null }] });
    expect(un(f, "g").alertes).toEqual([]);
  });

  it("fiche technique : le coût d'une ligne en g change quand l'article passe de kg à g (même prix, autre unité)", () => {
    const f = vierge({ fiches: [{ fiche: "Pâte à pizza", unite: "g" }, { fiche: "Pâte à pizza", unite: "g" }, { fiche: "Brioche", unite: "g" }] });
    const l = un(f, "g");
    expect(l.alertes.join(" ")).toMatch(/Fiches techniques « Pâte à pizza », « Brioche » : 3 lignes changent de coût \(le prix reste le même chiffre, par g\)/);
  });

  it("fiche technique : une ligne qui ne se convertit plus rend le coût de la fiche INCOMPLET (jamais zéro)", () => {
    const f = vierge({ fiches: [{ fiche: "Pâte", unite: "g" }] });
    const a = un(f, "Sac").alertes.join(" ");
    expect(a).toContain("1 ligne ne sera plus convertible");
    expect(a).toContain("le coût de la fiche sera annoncé incomplet");
  });

  it("fiche technique : une ligne qui devient convertible est dite (le coût sera calculé avec le prix actuel)", () => {
    const f = vierge({ unite: "Sac", fiches: [{ fiche: "Pâte", unite: "g" }] });
    expect(un(f, "kg").alertes.join(" ")).toContain("1 ligne devient convertible");
  });

  it("contenance : elle ne sert qu'aux articles comptés à l'unité — Bouteille → L la rend inutilisée", () => {
    const f = vierge({ unite: "Bouteille", contenance: "75", contenanceUnite: "cl" });
    expect(un(f, "L").alertes.join(" ")).toContain("Contenance 75 cl par Bouteille");
    expect(un(vierge({ unite: "Bouteille", contenance: "75", contenanceUnite: "cl" }), "Pièce").alertes.join(" ")).not.toContain("Contenance");
  });

  it("unités par carton : saisi pour l'ancienne unité, à revérifier — et suffit à demander la confirmation", () => {
    const l = un(vierge({ uniteParCarton: "24" }), "g");
    expect(l.alertes.join(" ")).toContain("24 unités par carton");
    expect(l.confirmer).toBe(true);
  });
});

describe("apercuUnite — ce que la confirmation dit", () => {
  const lot = () => classerChangementUnite([
    vierge({ id: "1", designation: "Farine", stock: "12", nbMouvements: 4 }),
    vierge({ id: "2", designation: "Sucre", prix: "1 $" }),
    vierge({ id: "3", designation: "Sel", fiches: [{ fiche: "Pâte", unite: "g" }] }),
    vierge({ id: "4", designation: "Épice" }), // libre
    vierge({ id: "5", designation: "Levure", unite: "g" }), // déjà en g
    vierge({ id: "6", designation: "Poivre", unite: null }), // posée
  ], "g");

  it("compte, nomme et ne compte pas les articles libres, posés ou déjà dans la bonne unité", () => {
    const a = apercuUnite(lot(), "g");
    expect(a.total).toBe(6);
    expect(a.aConfirmer.map((l) => l.designation)).toEqual(["Farine", "Sucre", "Sel"]);
    expect(a.confirmes).toEqual(["1", "2", "3"]);
    expect(a).toMatchObject({ nbLibres: 1, nbInchanges: 1, nbPosees: 1, nbChangent: 5 });
    expect(a.resume).toContain("3 articles ont déjà du stock");
    expect(a.resume).toContain("leurs quantités et prix resteront les mêmes chiffres dans la nouvelle unité (g), rien n'est converti");
  });

  it("sans risque : résumé vide, rien à confirmer", () => {
    const a = apercuUnite(classerChangementUnite([vierge({ id: "1" }), vierge({ id: "2", unite: null, stock: "5" })], "g"), "g");
    expect(a.aConfirmer).toEqual([]);
    expect(a.resume).toBe("");
    expect(a.nbChangent).toBe(2);
  });

  it("un seul article : le singulier", () => {
    const a = apercuUnite(classerChangementUnite([vierge({ stock: "1" })], "g"), "g");
    expect(a.resume).toMatch(/^1 article a déjà du stock/);
  });
});
