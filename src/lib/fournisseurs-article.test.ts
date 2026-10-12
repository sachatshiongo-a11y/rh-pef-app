import { describe, it, expect } from "vitest";
import { fournisseursConnus, liensParArticle, optionsFournisseursPourArticle, optionsFournisseursPourArticles, GROUPE_AUTRES, GROUPE_CONNUS } from "./fournisseurs-article";
import { filtrerOptions } from "./recherche-options";

const TOUS = [{ id: "f1", nom: "Marché central" }, { id: "f2", nom: "Grossiste Nord" }, { id: "f3", nom: "Épicerie Kasa" }, { id: "f4", nom: "Zébu SARL" }];

describe("fournisseurs proposés pour UN article", () => {
  it("l'habituel d'abord, puis les autres connus par nom, puis TOUS les autres fournisseurs (rien n'est exclu)", () => {
    const o = optionsFournisseursPourArticle(TOUS, [{ fournisseurId: "f4", habituel: false }, { fournisseurId: "f2", habituel: true }, { fournisseurId: "f1", habituel: false }]);
    expect(o.map((x) => x.id)).toEqual(["f2", "f1", "f4", "f3"]);
    expect(o.map((x) => x.groupe)).toEqual([GROUPE_CONNUS, GROUPE_CONNUS, GROUPE_CONNUS, GROUPE_AUTRES]);
    expect(o[0].detail).toBe("habituel");
    expect(o[1].detail).toBeUndefined();
    expect(o).toHaveLength(TOUS.length);
  });
  it("article sans fournisseur connu : la liste complète, sans groupe, par nom — comme avant", () => {
    const o = optionsFournisseursPourArticle(TOUS, []);
    expect(o.map((x) => x.id)).toEqual(["f3", "f2", "f1", "f4"]);
    expect(o.every((x) => x.groupe === undefined)).toBe(true);
  });
  it("un lien vers un fournisseur absent de la liste (désactivé) est ignoré, sans doublon", () => {
    expect(fournisseursConnus(TOUS, [{ fournisseurId: "fX", habituel: true }, { fournisseurId: "f1", habituel: false }, { fournisseurId: "f1", habituel: false }]).map((c) => c.id)).toEqual(["f1"]);
  });
  it("on peut encore choisir un autre fournisseur en tapant : le filtre garde l'ordre des groupes", () => {
    const o = optionsFournisseursPourArticle(TOUS, [{ fournisseurId: "f2", habituel: true }]);
    expect(filtrerOptions(o, "zebu").map((x) => x.id)).toEqual(["f4"]);
    expect(filtrerOptions(o, "").map((x) => x.id)[0]).toBe("f2");
  });
});

describe("fournisseurs proposés pour un DOCUMENT de plusieurs articles", () => {
  const liens = liensParArticle([
    { articleId: "a1", fournisseurId: "f1", habituel: true }, { articleId: "a1", fournisseurId: "f2", habituel: false },
    { articleId: "a2", fournisseurId: "f2", habituel: true }, { articleId: "a3", fournisseurId: "f4", habituel: false },
  ]);
  it("ceux qui fournissent le plus d'articles du document en tête, avec « N sur M articles »", () => {
    const o = optionsFournisseursPourArticles(TOUS, liens, ["a1", "a2", "a3"]);
    expect(o.map((x) => x.id)).toEqual(["f2", "f1", "f4", "f3"]);
    expect(o[0]).toMatchObject({ detail: "2 sur 3 articles" });
    expect(o[1]).toMatchObject({ detail: "1 sur 3 articles" });
    expect(o[3].groupe).toBe(GROUPE_AUTRES);
  });
  it("aucun article choisi (ou sans fournisseur connu) : liste simple", () => {
    expect(optionsFournisseursPourArticles(TOUS, liens, ["", ""]).every((x) => !x.groupe)).toBe(true);
    expect(optionsFournisseursPourArticles(TOUS, liens, ["a9"])).toHaveLength(4);
  });
});
