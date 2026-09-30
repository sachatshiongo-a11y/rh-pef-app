import { describe, it, expect } from "vitest";
import { filtrerOptions, indexerOptions, motsDe, optionParId, optionsArticles, type OptionChoix } from "./recherche-options";

const o = (id: string, libelle: string, extra: Partial<OptionChoix> = {}): OptionChoix => ({ id, libelle, ...extra });
const ids = (l: OptionChoix[]) => l.map((x) => x.id);

describe("motsDe", () => {
  it("minuscules, sans accents, séparés par tout ce qui n'est pas lettre ou chiffre", () => {
    expect(motsDe("  Crème  fraîche-1L ")).toEqual(["creme", "fraiche", "1l"]);
    expect(motsDe("d'agneau")).toEqual(["d", "agneau"]);
    expect(motsDe("  -- ")).toEqual([]);
  });
});

describe("filtrerOptions", () => {
  const liste = [
    o("1", "Bacardi blanc-1l"),
    o("2", "Bacardi Carta Oro 70cl"),
    o("3", "Crème fraîche 1L"),
    o("4", "Épices mélangées"),
    o("5", "Carré d'agneau", { recherche: ["CA-AGN", "Agneau carré"] }),
  ];

  it("saisie vide : toute la liste, dans son ordre", () => {
    expect(ids(filtrerOptions(liste, ""))).toEqual(["1", "2", "3", "4", "5"]);
    expect(ids(filtrerOptions(liste, "   "))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("ignore les accents et la casse, dans les deux sens", () => {
    expect(ids(filtrerOptions(liste, "epices"))).toEqual(["4"]);
    expect(ids(filtrerOptions(liste, "CRÈME"))).toEqual(["3"]);
    expect(ids(filtrerOptions(liste, "creme fraiche"))).toEqual(["3"]);
  });

  it("les mots peuvent être dans le désordre : « bacardi 1l » trouve « Bacardi blanc-1l »", () => {
    expect(ids(filtrerOptions(liste, "bacardi 1l"))).toEqual(["1"]);
    expect(ids(filtrerOptions(liste, "1l bacardi"))).toEqual(["1"]);
    expect(ids(filtrerOptions(liste, "blanc bacardi"))).toEqual(["1"]);
  });

  it("cherche aussi dans le nom court et le code", () => {
    expect(ids(filtrerOptions(liste, "ca-agn"))).toEqual(["5"]);
    expect(ids(filtrerOptions(liste, "agn"))).toEqual(["5"]);
  });

  it("tous les mots doivent se retrouver", () => {
    expect(filtrerOptions(liste, "bacardi creme")).toEqual([]);
  });

  it("classe : début de libellé, puis début de mot, puis le reste ; ordre d'origine à égalité", () => {
    const l = [o("a", "Poivre noir"), o("b", "Noir de sésame"), o("c", "Noix"), o("d", "Patinoire"), o("e", "Sésame noir")];
    // « noir » : commence par → b ; début de mot → a, e ; en plein mot (« Patinoire ») → d
    expect(ids(filtrerOptions(l, "noir"))).toEqual(["b", "a", "e", "d"]);
  });

  it("garde les groupes dans leur ordre d'origine", () => {
    const l = [o("f1", "Mojito", { groupe: "Sous-recettes" }), o("a1", "Mojito citron", { groupe: "Articles" }), o("a2", "Citron vert", { groupe: "Articles" }), o("f2", "Citron confit", { groupe: "Autres" })];
    expect(ids(filtrerOptions(l, "citron"))).toEqual(["a2", "a1", "f2"]);
    expect(ids(filtrerOptions(l, "mojito"))).toEqual(["f1", "a1"]);
  });

  it("n'altère pas la liste reçue", () => {
    const copie = JSON.stringify(liste);
    filtrerOptions(liste, "bacardi");
    expect(JSON.stringify(liste)).toBe(copie);
  });
});

describe("index mémorisé", () => {
  it("calculé une fois par tableau, retrouve une option par son id", () => {
    const liste = [o("x", "Sel fin"), o("y", "Poivre")];
    expect(indexerOptions(liste)).toBe(indexerOptions(liste));
    expect(optionParId(liste, "y")?.libelle).toBe("Poivre");
    expect(optionParId(liste, "zzz")).toBeUndefined();
  });

  it("reste rapide sur un catalogue de 1 000 articles", () => {
    const grand = Array.from({ length: 1000 }, (_, i) => o(`a${i}`, `Article numéro ${i} pour la cuisine`, { recherche: [`C${i}`, i % 7 === 0 ? `Court ${i}` : null] }));
    filtrerOptions(grand, ""); // indexe
    const t = performance.now();
    for (let k = 0; k < 50; k++) filtrerOptions(grand, "article 99 cuisine");
    expect((performance.now() - t) / 50).toBeLessThan(25); // ms par frappe, large marge
    const attendus = Array.from({ length: 1000 }, (_, i) => i).filter((i) => String(i).includes("99"));
    const trouves = ids(filtrerOptions(grand, "article 99 cuisine"));
    expect(trouves[0]).toBe("a99"); // « 99 » en début de mot avant « 199 », « 990 »…
    expect([...trouves].sort()).toEqual(attendus.map((i) => `a${i}`).sort());
  });
});

describe("optionsArticles", () => {
  it("désignation affichée ; nom court et code cherchés ; inactifs marqués à la demande", () => {
    const opts = optionsArticles([
      { id: "1", designation: "Carré d'agneau", nomCourt: "Agneau", code: "137" },
      { id: "2", designation: "Vieux vin", actif: false },
    ], { marquerInactifs: true });
    expect(opts[0]).toMatchObject({ id: "1", libelle: "Carré d'agneau" });
    expect(ids(filtrerOptions(opts, "137"))).toEqual(["1"]);
    expect(ids(filtrerOptions(opts, "agneau"))).toEqual(["1"]);
    expect(opts[1]).toMatchObject({ libelle: "Vieux vin (inactif)", attenue: true });
    expect(optionsArticles([{ id: "2", designation: "Vieux vin", actif: false }])[0].libelle).toBe("Vieux vin");
  });
});
