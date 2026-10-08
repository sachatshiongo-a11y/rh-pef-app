import { describe, it, expect } from "vitest";
import { alerteUnite, cleRattachement, planifierRattachementsAuto, proposerRattachements, type CibleAuto, type RestoAuto } from "./rattachement-resto";
import { facteur } from "./conversion";

const cat = (id: string, designation: string, actif = true, unite: string | null = "kg") => ({ id, designation, actif, unite });
const resto = (id: string, designation: string, articleStockId: string | null = null, unite: string | null = "kg") => ({ id, designation, articleStockId, unite });
const kg = { uniteResto: "kg", uniteCatalogue: "kg", alerteUnite: null };

describe("proposerRattachements — jamais de rattachement deviné", () => {
  it("propose les noms identiques, sans tenir compte de la casse ni des espaces", () => {
    const p = proposerRattachements([resto("r1", "  Huile  de palme "), resto("r2", "BEURRE")], [cat("a1", "Huile de palme"), cat("a2", "Beurre")]);
    expect(p).toEqual([
      { articleRestoId: "r1", designationResto: "  Huile  de palme ", articleStockId: "a1", designationCatalogue: "Huile de palme", ...kg },
      { articleRestoId: "r2", designationResto: "BEURRE", articleStockId: "a2", designationCatalogue: "Beurre", ...kg },
    ]);
  });

  it("ne propose rien pour un nom seulement proche (pluriel, mot en plus)", () => {
    expect(proposerRattachements([resto("r2", "Tomates"), resto("r3", "Tomate cerise")], [cat("a2", "Tomate")])).toEqual([]);
  });

  it("même clé que le rattachement automatique (2026-10-08) : accents, ponctuation et nom court ne séparent plus", () => {
    const p = proposerRattachements([resto("r1", "Creme"), resto("r2", "Carré d'agneau")], [cat("a1", "Crème"), { ...cat("a2", "AGNEAU CARRE FRANCE 1KG"), nomCourt: "Carré d'agneau" }]);
    expect(p.map((x) => [x.articleRestoId, x.articleStockId])).toEqual([["r1", "a1"], ["r2", "a2"]]);
  });

  it("ignore un article du restaurant déjà rattaché", () => {
    expect(proposerRattachements([resto("r1", "Beurre", "a9")], [cat("a2", "Beurre")])).toEqual([]);
  });

  it("ignore un article du catalogue inactif, et refuse l'ambiguïté (deux candidats)", () => {
    expect(proposerRattachements([resto("r1", "Beurre")], [cat("a2", "Beurre", false)])).toEqual([]);
    expect(proposerRattachements([resto("r1", "Sel")], [cat("a1", "Sel"), cat("a2", "SEL")])).toEqual([]);
  });

  it("cleRattachement : accents, casse, espaces, ponctuation, contenance canonique", () => {
    expect(cleRattachement(" Crème  Fraîche ")).toBe("cremefraiche");
    expect(cleRattachement("Creme")).toBe(cleRattachement("Crème"));
    expect(cleRattachement("Coca-Cola 33 cl")).toBe(cleRattachement("coca cola 0,33L"));
    expect(cleRattachement("Eau Vivreau 1L")).toBe(cleRattachement("EAU VIVREAU 100cl"));
    expect(cleRattachement("Eau Vivreau 1L")).toBe(cleRattachement("Eau vivreau 1000 ml"));
    expect(cleRattachement("Farfalle 500g")).toBe(cleRattachement("Farfalle 0,5 kg"));
    expect(cleRattachement("Farfalle 500 gr")).toBe(cleRattachement("farfalle 500g"));
    // Rien n'est confondu au-delà : contenance différente, pluriel, mot en plus, autre mot après le nombre.
    expect(cleRattachement("Eau 1L")).not.toBe(cleRattachement("Eau 1,5L"));
    expect(cleRattachement("Tomate")).not.toBe(cleRattachement("Tomates"));
    expect(cleRattachement("2 lapins")).toBe("2lapins");
    expect(cleRattachement("   ")).toBe("");
    expect(cleRattachement(null)).toBe("");
  });
});

describe("propositions — unités du restaurant et du catalogue", () => {
  it("chaque proposition porte les deux unités ; conversion possible (g → kg, emballage) : pas d'alerte", () => {
    const p = proposerRattachements(
      [resto("r1", "Farine", null, "g"), resto("r2", "Penne", null, "g")],
      [cat("a1", "Farine", true, "kg"), cat("a2", "Penne", true, "500 GR")],
    );
    expect(p.map((x) => [x.uniteResto, x.uniteCatalogue, x.alerteUnite])).toEqual([["g", "kg", null], ["g", "500 GR", null]]);
  });

  it("conversion impossible : « unités incompatibles » (masse contre volume, comptages différents)", () => {
    expect(alerteUnite("bouteille", { unite: "l" })).toBe("UNITES_INCOMPATIBLES");
    expect(alerteUnite("kg", { unite: "l" })).toBe("UNITES_INCOMPATIBLES");
    expect(alerteUnite("pièce", { unite: "paquet" })).toBe("UNITES_INCOMPATIBLES");
    const [p] = proposerRattachements([resto("r1", "Vin", null, "bouteille")], [cat("a1", "Vin", true, "l")]);
    expect(p).toMatchObject({ uniteResto: "bouteille", uniteCatalogue: "l", alerteUnite: "UNITES_INCOMPATIBLES" });
  });

  it("l'une des deux unités vide (ou blanche) — ou les deux : « unité manquante », toujours proposée", () => {
    expect(alerteUnite(null, { unite: "kg" })).toBe("UNITE_MANQUANTE");
    expect(alerteUnite("kg", { unite: "  " })).toBe("UNITE_MANQUANTE");
    expect(alerteUnite("", { unite: "" })).toBe("UNITE_MANQUANTE");
    expect(alerteUnite(null, { unite: null })).toBe("UNITE_MANQUANTE");
    expect(proposerRattachements([resto("r1", "Sel", null, null)], [cat("a1", "Sel", true, null)])).toHaveLength(1);
  });
});

describe("facteur — deux unités VIDES ne sont pas identiques", () => {
  it("vide ↔ vide, blanc ↔ blanc, vide ↔ unité : null (« unité manquante »), jamais 1", () => {
    expect(facteur("", "")).toBeNull();
    expect(facteur("  ", " ")).toBeNull();
    expect(facteur("", "kg")).toBeNull();
    expect(facteur("kg", "")).toBeNull();
    expect(facteur("500 GR", "500 GR")!.toString()).toBe("1"); // l'identité d'une vraie unité reste 1
  });
});

// ─── Rattachement automatique (2026-10-08) ─────────────────────────────────────────────────────

const C = (id: string, designation: string, o: Partial<CibleAuto> = {}): CibleAuto => ({
  id, designation, nomCourt: null, actif: true, domaine: "NOURRITURE", unite: "Paquet", contenance: null, contenanceUnite: null, categorie: "Pâtes", ...o,
});
const R = (id: string, designation: string, o: Partial<RestoAuto> = {}): RestoAuto => ({
  id, designation, espace: "CUISINE", unite: "Paquet", actif: true, articleStockId: null, rattacheA: null, ...o,
});

describe("planifierRattachementsAuto — automatique, jamais deviné", () => {
  it("(a) un seul article du restaurant libre au même nom : RATTACHER", () => {
    expect(planifierRattachementsAuto([C("a1", "Farfalle Molisana")], [R("r1", "FARFALLE  molisana"), R("r2", "Penne")])).toEqual([
      { action: "RATTACHER", articleStockId: "a1", articleRestoId: "r1", designationResto: "FARFALLE  molisana", espace: "CUISINE" },
    ]);
  });

  it("(a) le nom court du catalogue vaut sa désignation ; la contenance s'écrit de plusieurs façons", () => {
    const d = planifierRattachementsAuto(
      [C("a1", "MOLISANA FARFALLE N°65 500G", { nomCourt: "Farfalle" }), C("a2", "Coca-Cola 33cl", { domaine: "BOISSON", unite: "Bouteille" })],
      [R("r1", "Farfalle"), R("r2", "Coca Cola 0,33 L", { espace: "BAR", unite: "Bouteille" })],
    );
    expect(d.map((x) => [x.action, x.articleStockId, "articleRestoId" in x ? x.articleRestoId : null])).toEqual([["RATTACHER", "a1", "r1"], ["RATTACHER", "a2", "r2"]]);
  });

  it("(b) aucun candidat : CRÉER (nom court sinon désignation, unité et catégorie du catalogue, espace du domaine)", () => {
    const d = planifierRattachementsAuto(
      [C("a1", "Farfalle Molisana"), C("a2", "JACK DANIELS 70CL", { nomCourt: "Jack Daniel's", domaine: "BOISSON", unite: "Bouteille", contenance: "70", contenanceUnite: "cl", categorie: null })],
      [R("r9", "Penne")],
    );
    expect(d).toEqual([
      { action: "CREER", articleStockId: "a1", designation: "Farfalle Molisana", unite: "Paquet", categorie: "Pâtes", espace: "CUISINE" },
      { action: "CREER", articleStockId: "a2", designation: "Jack Daniel's", unite: "Bouteille", categorie: "À classer", espace: "BAR" },
    ]);
  });

  it("(c) plusieurs candidats libres : LAISSER avec le choix nommé — rien n'est créé", () => {
    const [d] = planifierRattachementsAuto([C("a1", "Citron", { domaine: "AUTRE" })], [R("r1", "Citron"), R("r2", "citron", { espace: "BAR" })]);
    expect(d).toMatchObject({ action: "LAISSER", motif: "PLUSIEURS_CANDIDATS" });
    expect((d as { raison: string }).raison).toBe("2 articles du restaurant portent ce nom (« Citron », Cuisine ; « citron », Bar) : choisissez");
  });

  it("plusieurs candidats, mais un seul dans l'espace du domaine : c'est lui (même règle que les livraisons)", () => {
    const d = planifierRattachementsAuto([C("a1", "Citron", { domaine: "BOISSON" })], [R("r1", "Citron"), R("r2", "Citron", { espace: "BAR" })]);
    expect(d).toMatchObject([{ action: "RATTACHER", articleRestoId: "r2", espace: "BAR" }]);
  });

  it("un candidat aux unités inconvertibles ou absentes : LAISSER (jamais rattaché d'office), sans créer de doublon", () => {
    const d = planifierRattachementsAuto([C("a1", "Vin rouge", { unite: "l" }), C("a2", "Sel", { unite: "kg" })], [R("r1", "Vin rouge", { unite: "bouteille" }), R("r2", "Sel", { unite: null })]);
    expect(d.map((x) => [x.action, "motif" in x ? x.motif : null])).toEqual([["LAISSER", "UNITES"], ["LAISSER", "UNITES"]]);
    expect((d[0] as { raison: string }).raison).toContain("restaurant : bouteille, catalogue : l");
  });

  it("homonyme déjà rattaché ailleurs ou désactivé dans l'espace : LAISSER pour ne pas créer de doublon", () => {
    const d = planifierRattachementsAuto(
      [C("a1", "Farfalle"), C("a2", "Penne")],
      [R("r1", "Farfalle", { articleStockId: "a9", rattacheA: "Farfalle Barilla" }), R("r2", "Penne", { actif: false })],
    );
    expect(d.map((x) => (x as { raison: string }).raison)).toEqual([
      "« Farfalle » existe déjà au restaurant (Cuisine, rattaché à « Farfalle Barilla ») : choisissez, pour ne pas créer de doublon",
      "« Penne » existe déjà au restaurant (Cuisine, désactivé) : choisissez, pour ne pas créer de doublon",
    ]);
  });

  it("homonyme dans l'AUTRE espace seulement : la création dans l'espace du domaine reste permise", () => {
    expect(planifierRattachementsAuto([C("a1", "Citron")], [R("r1", "Citron", { espace: "BAR", articleStockId: "a9" })])).toMatchObject([{ action: "CREER", espace: "CUISINE" }]);
  });

  it("domaine « Autre », unité du catalogue manquante, catalogue désactivé, rattaché à un article désactivé : LAISSER", () => {
    const d = planifierRattachementsAuto(
      [C("a1", "Gaz", { domaine: "AUTRE" }), C("a2", "Sucre", { unite: " " }), C("a3", "Riz", { actif: false }), C("a4", "Thon")],
      [R("r4", "Thon en boîte", { actif: false, articleStockId: "a4" })],
    );
    expect(d.map((x) => [x.articleStockId, (x as { motif: string }).motif])).toEqual([
      ["a1", "DOMAINE_AUTRE"], ["a2", "UNITE_CATALOGUE"], ["a3", "CATALOGUE_INACTIF"], ["a4", "RATTACHE_DESACTIVE"],
    ]);
  });

  it("déjà rattaché (actif) : rien à faire, absent du plan", () => {
    expect(planifierRattachementsAuto([C("a1", "Sel")], [R("r1", "Autre nom", { articleStockId: "a1" })])).toEqual([]);
  });

  it("deux cibles livrées au même nom : AUCUNE n'est rattachée ni créée (jamais « la première gagne »)", () => {
    const d = planifierRattachementsAuto([C("a1", "Farfalle"), C("a2", "FARFALLE")], [R("r1", "Farfalle")]);
    expect(d.map((x) => [x.action, x.articleStockId, (x as { motif?: string }).motif])).toEqual([
      ["LAISSER", "a1", "PLUSIEURS_ARTICLES_CATALOGUE"], ["LAISSER", "a2", "PLUSIEURS_ARTICLES_CATALOGUE"],
    ]);
    expect((d[0] as { raison: string }).raison).toBe("« FARFALLE » porte le même nom au catalogue : rattachez à la main (ou fusionnez les doublons du catalogue)");
  });

  it("nom porté par un AUTRE article actif du catalogue, même non livré (nom court partagé) : laissé", () => {
    const catalogue = [{ id: "a1", designation: "Coca-Cola 33cl", nomCourt: "Coca" }, { id: "a2", designation: "Coca-Cola 50cl", nomCourt: "Coca" }, { id: "a3", designation: "Sel", nomCourt: null }];
    const d = planifierRattachementsAuto([C("a1", "Coca-Cola 33cl", { nomCourt: "Coca", domaine: "BOISSON" }), C("a3", "Sel")], [R("r1", "Coca", { espace: "BAR" })], catalogue);
    expect(d.map((x) => [x.action, x.articleStockId, (x as { motif?: string }).motif ?? null])).toEqual([["LAISSER", "a1", "PLUSIEURS_ARTICLES_CATALOGUE"], ["CREER", "a3", null]]);
    // Un article DÉSACTIVÉ du catalogue n'est pas un porteur : il n'empêche rien.
    expect(planifierRattachementsAuto([C("a1", "Sel"), C("a9", "Sel", { actif: false })], [R("r1", "Sel")]).map((x) => x.action)).toEqual(["RATTACHER", "LAISSER"]);
  });

  it("un seul candidat libre, mais dans l'AUTRE espace que le domaine : rattaché (comportement figé, annoncé « (Bar) »)", () => {
    expect(planifierRattachementsAuto([C("a1", "Citron")], [R("r1", "Citron", { espace: "BAR" })])).toEqual([
      { action: "RATTACHER", articleStockId: "a1", articleRestoId: "r1", designationResto: "Citron", espace: "BAR" },
    ]);
  });

  it("le nom court d'un article vaut la désignation d'un autre : les deux sont laissés, rien n'est créé", () => {
    const e = planifierRattachementsAuto([C("a1", "Penne"), C("a2", "Penne rigate", { nomCourt: "Penne" })], []);
    expect(e.every((x) => x.action === "LAISSER")).toBe(true); // nom court = désignation d'un autre : ambigu
  });
});
