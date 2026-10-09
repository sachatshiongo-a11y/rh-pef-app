import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { chercheurParContenance, complementLibelle, contenanceEnregistree, formaterContenance, incoherenceContenance, libelleArticle, rechercheContenance } from "./libelle-article";
import { filtrerOptions, optionsArticles } from "./recherche-options";
import { articleDansFiltre, FILTRE_INVENTAIRE_VIDE } from "./filtre-inventaire";

const art = (designation: string, contenance: Decimal.Value | null = null, contenanceUnite: string | null = null) => ({ designation, contenance, contenanceUnite });

describe("libelleArticle : la contenance s'insère dans le nom affiché", () => {
  it("ajoute la contenance enregistrée quand le nom ne la porte pas", () => {
    expect(libelleArticle(art("Absolut Vodka", "75", "cl"))).toBe("Absolut Vodka 75 cl");
    expect(libelleArticle(art("Campari", "1", "l"))).toBe("Campari 1 l");
    expect(libelleArticle(art("Monin Coco Powder", "2", "kg"))).toBe("Monin Coco Powder 2 kg");
    expect(libelleArticle(art("Hendrick's", "700", "ml"))).toBe("Hendrick's 700 ml");
    expect(libelleArticle(art("Sucre", "500", "g"))).toBe("Sucre 500 g");
  });

  it("format homogène : nombre à la française, unité en minuscules, espaces de fin retirées", () => {
    expect(libelleArticle(art("Vin rouge", "0.75", "l"))).toBe("Vin rouge 0,75 l");
    expect(libelleArticle(art("Eau ", "1.5", "L"))).toBe("Eau 1,5 l");
    expect(libelleArticle(art("Sirop", "1000", "ml"))).toBe("Sirop 1000 ml"); // sans espace des milliers : « 1 000 ml » se relirait « 000 ml »
    expect(libelleArticle(art("Eau", "1500", "ml"))).toBe("Eau 1500 ml");
    expect(libelleArticle(art("Gin", "70.000", "cl"))).toBe("Gin 70 cl");
    expect(formaterContenance({ quantite: "0.125", unite: "KG" })).toBe("0,125 kg");
  });

  it("accepte le Decimal de Prisma (ou tout objet qui s'écrit en texte) et les nombres", () => {
    expect(libelleArticle(art("Rhum", new Decimal("70"), "cl"))).toBe("Rhum 70 cl");
    expect(libelleArticle({ designation: "Rhum", contenance: { toString: () => "70" }, contenanceUnite: "cl" })).toBe("Rhum 70 cl");
    expect(libelleArticle(art("Rhum", 70, "cl"))).toBe("Rhum 70 cl");
  });

  it("n'ajoute rien quand le nom porte déjà la contenance, sous toutes ses écritures", () => {
    for (const nom of ["Absolut Vodka-70cl", "Absolut Vodka 70 cl", "Absolut Vodka 700ml", "Absolut Vodka 0,7L", "ABSOLUT VODKA 70CL"]) {
      expect(libelleArticle(art(nom, "70", "cl")), nom).toBe(nom);
    }
    for (const nom of ["Campari-1L", "Campari 1 l", "Campari 100cl", "Campari 1000ml", "MONIN COCONUT 1LTR", "Campari 1 litre"]) {
      expect(libelleArticle(art(nom, "1", "l")), nom).toBe(nom);
      expect(libelleArticle(art(nom, "100", "cl")), nom).toBe(nom);
      expect(libelleArticle(art(nom, "1000", "ml")), nom).toBe(nom);
    }
    expect(libelleArticle(art("Monin Powder 2KG", "2000", "g"))).toBe("Monin Powder 2KG");
    // Multiplicateur collé : « 6x33cl » porte bien 33 cl (pas de « Heineken 6x33cl 33 cl »).
    for (const nom of ["Heineken 6x33cl", "Heineken 24X33CL", "Heineken 6 x 33cl"]) expect(libelleArticle(art(nom, "33", "cl")), nom).toBe(nom);
    // … mais une lettre devant la contenance reste un nom (« Box33cl ») : on ajoute.
    expect(libelleArticle(art("Box33cl", "33", "cl"))).toBe("Box33cl 33 cl");
    // Plusieurs mentions : il suffit que l'une soit la contenance enregistrée.
    expect(libelleArticle(art("Pack 6 x 33cl", "33", "cl"))).toBe("Pack 6 x 33cl");
  });

  it("sans contenance enregistrée (ou illisible) : la désignation telle quelle", () => {
    expect(libelleArticle(art("Farine"))).toBe("Farine");
    expect(libelleArticle(art("Farine", "25", null))).toBe("Farine");
    expect(libelleArticle(art("Farine", null, "kg"))).toBe("Farine");
    expect(libelleArticle(art("Farine", "0", "kg"))).toBe("Farine");
    expect(libelleArticle(art("Farine", "abc", "kg"))).toBe("Farine");
    expect(libelleArticle(art("Farine", "25", "sac"))).toBe("Farine"); // unité qui n'est pas une contenance
    expect(libelleArticle({ designation: "Farine" })).toBe("Farine");
    expect(complementLibelle(art("Farine"))).toBeNull();
  });

  it("une autre contenance dans le nom : rien n'est ajouté, l'incohérence est signalée", () => {
    const a = art("Cointreau-70cl", "1", "l");
    expect(libelleArticle(a)).toBe("Cointreau-70cl");
    expect(complementLibelle(a)).toBeNull();
    expect(incoherenceContenance(a)).toEqual({ dansNom: "70 cl", enregistree: "1 l", message: "le nom dit 70 cl, la contenance enregistrée est 1 l" });
    // Masse contre volume : incohérent aussi.
    expect(incoherenceContenance(art("Sucre 1kg", "1", "l"))?.message).toBe("le nom dit 1 kg, la contenance enregistrée est 1 l");
  });

  it("pas d'incohérence quand c'est cohérent, sans contenance, ou sans mention dans le nom", () => {
    expect(incoherenceContenance(art("Cointreau-70cl", "700", "ml"))).toBeNull();
    expect(incoherenceContenance(art("Cointreau-70cl"))).toBeNull();
    expect(incoherenceContenance(art("Cointreau", "70", "cl"))).toBeNull();
    // Un nombre sans unité n'est pas une contenance (« Jus d'Ananas-100 ») : on ajoute.
    expect(libelleArticle(art("Jus d'Ananas-100", "1", "l"))).toBe("Jus d'Ananas-100 1 l");
    // Un nombre collé à une lettre non plus (« V8 ») — lecture partagée avec `contenanceDansNom`.
    expect(libelleArticle(art("V8", "33", "cl"))).toBe("V8 33 cl");
  });

  it("contenanceEnregistree lit l'unité sans tenir compte de la casse ni des espaces", () => {
    expect(contenanceEnregistree({ contenance: "75", contenanceUnite: " CL " })?.unite).toBe("cl");
    expect(contenanceEnregistree({ contenance: "75", contenanceUnite: "bouteille" })).toBeNull();
  });
});

describe("recherche par contenance", () => {
  it("donne les écritures compactes de la contenance enregistrée", () => {
    expect(rechercheContenance({ contenance: "1", contenanceUnite: "l" })).toEqual(["1000ml", "100cl", "1l"]);
    expect(rechercheContenance({ contenance: "75", contenanceUnite: "cl" })).toEqual(["750ml", "75cl", "0,75l"]);
    expect(rechercheContenance({ contenance: "2", contenanceUnite: "kg" })).toEqual(["2000g", "2kg"]);
    expect(rechercheContenance({ contenance: null, contenanceUnite: null })).toEqual([]);
  });

  it("« bacardi 1l » trouve Bacardi même si la contenance n'est que dans le champ contenance", () => {
    const options = optionsArticles([
      { id: "a", designation: "Bacardi blanc", contenance: "1", contenanceUnite: "l" },
      { id: "b", designation: "Bacardi blanc", contenance: "70", contenanceUnite: "cl" },
      { id: "c", designation: "Bacardi Oro-1L" },
    ]);
    expect(options.map((o) => o.libelle)).toEqual(["Bacardi blanc 1 l", "Bacardi blanc 70 cl", "Bacardi Oro-1L"]);
    expect(filtrerOptions(options, "bacardi 1l").map((o) => o.id)).toEqual(["a", "c"]);
    expect(filtrerOptions(options, "bacardi 100cl").map((o) => o.id)).toEqual(["a"]);
    expect(filtrerOptions(options, "bacardi 1 l").map((o) => o.id)).toEqual(["a", "c"]);
    expect(filtrerOptions(options, "bacardi 700ml").map((o) => o.id)).toEqual(["b"]);
    expect(filtrerOptions(options, "bacardi 70 cl").map((o) => o.id)).toEqual(["b"]);
  });
});

describe("recherche globale et filtre de l'inventaire par contenance", () => {
  const CREME = { designation: "Crème fraîche", contenance: "1", contenanceUnite: "l" };
  const BIERE = { designation: "Bière Primus", contenance: "72", contenanceUnite: "cl" };
  const CAMPARI = { designation: "Campari-1L" };

  it("accents ignorés, contenance canonique (enregistrée ou écrite dans le nom), « 1l » seul", () => {
    expect(chercheurParContenance("creme")).toBeNull(); // aucune contenance tapée : recherche ordinaire
    const crème1l = chercheurParContenance("crème 1000ml")!;
    expect([CREME, BIERE, CAMPARI].map(crème1l)).toEqual([true, false, false]);
    expect([CREME, BIERE, CAMPARI].map(chercheurParContenance("CREME 100cl")!)).toEqual([true, false, false]);
    expect([CREME, BIERE, CAMPARI].map(chercheurParContenance("biere 72 cl")!)).toEqual([false, true, false]);
    expect([CREME, BIERE, CAMPARI].map(chercheurParContenance("1l")!)).toEqual([true, false, true]);
    expect([CREME, BIERE, CAMPARI].map(chercheurParContenance("creme 50cl")!)).toEqual([false, false, false]);
  });

  it("le filtre de l'inventaire lit « 1,5l » comme « 1.5l »", () => {
    const eau = { designation: "Eau Vitale", contenance: "1.5", contenanceUnite: "l", code: null, niveau: null, prix: null, fournisseurId: null, stockMinimum: "0", unite: "Bouteille", quantite: "0" };
    for (const q of ["eau 1,5l", "eau 1.5l", "vitale 150cl", "eau 1,5 l"]) expect(articleDansFiltre(eau, { ...FILTRE_INVENTAIRE_VIDE, q }), q).toBe(true);
    expect(articleDansFiltre(eau, { ...FILTRE_INVENTAIRE_VIDE, q: "eau 50cl" })).toBe(false);
  });
});

