// Liste d'achat — la logique de saisie PURE, partagée par le tableur et la vue téléphone.
import { describe, it, expect } from "vitest";
import {
  avecArticle, avecArticleChoisi, avecChangement, avecDevise, construireFormData, erreursDe, fournisseursProches, indexFournisseurs, jourCourt, lireBrouillon, produit,
  serialiserBrouillon, vide, vierge, aEnregistrer, lignesAConfirmer, montantNonConverti, phraseDevise, sansArticleDisparu, type Art, type Ligne,
} from "./liste-achat-saisie";

const HUILE: Art = { id: "a2", designation: "Huile de palme", unite: "pièce", domaine: "NOURRITURE", prix: "1.70" };
const SEL: Art = { id: "a9", designation: "Sel gris", unite: "Kg", domaine: "NOURRITURE", prix: null };

describe("calcul d'une ligne", () => {
  it("quantité × PU au centime, vide si l'un manque ; le montant tapé n'est jamais écrasé par un changement d'article", () => {
    expect(produit("2,5", "3")).toBe("7,5");
    expect(produit("", "3")).toBe("");
    const l = avecChangement({ ...vide("USD"), qte: "10" }, { montant: "45" });
    expect(avecArticle(l, HUILE, 2800).montant).toBe("45");
    expect(avecArticle(l, HUILE, 2800).pu).toBe("1,7"); // le prix du catalogue est proposé
  });

  it("changer de devise ne convertit que le PU du catalogue, et revient exactement en arrière", () => {
    const l = avecChangement(avecArticle(vide("USD"), HUILE, 2800), { qte: "2" });
    const fc = avecDevise(l, "CDF", 2800);
    expect([fc.devise, fc.pu, fc.montant]).toEqual(["CDF", "4760", "9520"]);
    const retour = avecDevise(fc, "USD", 2800);
    expect([retour.devise, retour.pu, retour.montant]).toEqual(["USD", "1,7", "3,4"]);
    expect(avecDevise(l, "USD", 2800)).toBe(l);
  });

  it("article sans prix : le PU de l'ancien article s'efface", () => {
    const l = avecChangement(avecArticle(vide("USD"), HUILE, 2800), { qte: "2" });
    const sans = avecArticle(l, SEL, 2800);
    expect([sans.pu, sans.montant, sans.puCatalogue]).toEqual(["", "", null]);
  });

  it("vierge / à enregistrer : le même filtre que le serveur (article ou désignation, quantité > 0)", () => {
    expect(vierge(vide("USD"))).toBe(true);
    expect(vierge({ ...vide("USD"), fournNom: "X" })).toBe(false);
    expect(aEnregistrer({ ...vide("USD"), designation: "Sel", qte: "0" })).toBe(false);
    expect(aEnregistrer({ ...vide("USD"), designation: "Sel", qte: "1,5" })).toBe(true);
  });
});

describe("l'envoi", () => {
  it("date, origine, puis par ligne : articleId, designation, unite, domaine, quantite, montant, devise, dlc, fournisseurNom, fournisseurId, creerNouveau — jamais le PU", () => {
    const lignes: Ligne[] = [
      { ...vide("CDF"), articleId: "a2", designation: "Huile", unite: "pièce", qte: "2,5", pu: "4760", montant: "11900", fournNom: "maman epiphanie" },
      { ...vide("USD"), designation: "Tomate", unite: "kg", qte: "3", dlc: "2026-10-20", creerNouveau: true },
    ];
    const fd = construireFormData({ date: "2026-10-07", origine: "Marché", lignes, idFourn: (n) => (n ? "f0" : "") });
    expect([...fd.entries()]).toEqual([
      ["date", "2026-10-07"], ["origine", "Marché"],
      ["articleId", "a2"], ["designation", "Huile"], ["unite", "pièce"], ["domaine", "NOURRITURE"], ["quantite", "2,5"], ["montant", "11900"], ["devise", "CDF"], ["dlc", ""], ["fournisseurNom", "maman epiphanie"], ["fournisseurId", "f0"], ["creerNouveau", ""],
      ["articleId", ""], ["designation", "Tomate"], ["unite", "kg"], ["domaine", "NOURRITURE"], ["quantite", "3"], ["montant", ""], ["devise", "USD"], ["dlc", "2026-10-20"], ["fournisseurNom", ""], ["fournisseurId", ""], ["creerNouveau", "1"],
    ]);
  });

  it("« Utiliser … » (article proche choisi) garde le PU TAPÉ et son montant ; un PU vide ou repris du catalogue suit le nouvel article", () => {
    const tape = { ...vide("USD"), designation: "Tomate", qte: "5", pu: "2", montant: "10", creerNouveau: true };
    const choisi = avecArticleChoisi(tape, { id: "t1", designation: "Tomates", unite: "kg", domaine: "NOURRITURE", prix: "1.8" }, 2800);
    expect([choisi.articleId, choisi.designation, choisi.unite, choisi.pu, choisi.montant, choisi.creerNouveau]).toEqual(["t1", "Tomates", "kg", "2", "10", false]);
    const sansPu = avecArticleChoisi({ ...vide("USD"), designation: "Tomate", qte: "5" }, { id: "t1", designation: "Tomates", unite: "kg", domaine: "NOURRITURE", prix: "1.8" }, 2800);
    expect([sansPu.pu, sansPu.montant]).toEqual(["1,8", "9"]);
  });
});

describe("fournisseurs proches", () => {
  const F = [{ id: "f0", nom: "Maman Épiphanie" }, { id: "f1", nom: "Grossiste Kin" }, { id: "f2", nom: "Grossiste Lubumbashi" }];
  it("par morceau de nom, sans accent ni casse ; rien si le nom est déjà exact", () => {
    expect(fournisseursProches("gross", F).map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(fournisseursProches("epiph", F).map((f) => f.id)).toEqual(["f0"]);
    expect(fournisseursProches("grossiste kin", F)).toEqual([]);
    expect(fournisseursProches("", F)).toEqual([]);
  });
});

describe("validation du panneau", () => {
  it("article requis, quantité > 0, nombres lisibles — mêmes règles et messages que la case du tableur", () => {
    expect(Object.keys(erreursDe(vide("USD"))).sort()).toEqual(["article", "qte"]);
    expect(erreursDe({ ...vide("USD"), designation: "Sel", qte: "2" })).toEqual({});
    expect(erreursDe({ ...vide("USD"), designation: "Sel", qte: "1,250" }).qte).toContain("ambigu");
    expect(erreursDe({ ...vide("USD"), designation: "Sel", qte: "2", montant: "abc" }).montant).toContain("n'est pas un nombre");
    expect(erreursDe({ ...vide("USD"), designation: "Sel", qte: "2", pu: "-1" }).pu).toBeDefined();
  });
});

describe("brouillon", () => {
  const l: Ligne = { ...vide("USD"), articleId: "a0", designation: "Farine", qte: "2" };
  it("aller-retour ; les lignes vides ne sont pas gardées", () => {
    const b = lireBrouillon(serialiserBrouillon({ jour: "2026-10-06", date: "2026-10-06", origine: "x", deviseDefaut: "CDF", lignes: [l, vide("USD")] }));
    expect(b).toMatchObject({ v: 1, jour: "2026-10-06", date: "2026-10-06", origine: "x", deviseDefaut: "CDF" });
    expect(b!.lignes).toEqual([l]);
  });
  it("rien d'exploitable → null, jamais d'exception", () => {
    for (const x of [null, "", "{", "null", "[]", '{"v":1}', '{"v":1,"lignes":[]}', '{"v":3,"lignes":[{"qte":"1"}]}']) expect(lireBrouillon(x), String(x)).toBeNull();
  });
  it("valeurs assainies : devise, domaine, dates, longueurs, 200 lignes au plus", () => {
    const lignes = Array.from({ length: 300 }, (_, i) => ({ designation: `Article ${i}`, devise: "EUR", domaine: "??", qte: "1" }));
    const b = lireBrouillon(JSON.stringify({ v: 1, jour: "hier", date: "2099", deviseDefaut: "EUR", origine: "o".repeat(1000), lignes }))!;
    expect(b.lignes).toHaveLength(200);
    expect(b.lignes[0]).toMatchObject({ devise: "USD", domaine: "NOURRITURE" });
    expect([b.jour, b.date, b.deviseDefaut, b.origine.length]).toEqual(["", "", "USD", 300]);
  });
});

describe("jourCourt", () => {
  it("lit la chaîne, sans calendrier de l'appareil", () => {
    expect(jourCourt("2026-10-07")).toBe("7 oct. 2026");
    expect(jourCourt("2026-01-01")).toBe("1 janv. 2026");
    expect(jourCourt("n'importe quoi")).toBe("n'importe quoi");
  });
});

describe("changement de devise : quels montants ne sont pas convertis", () => {
  const catalogue = avecChangement(avecArticle(vide("USD"), HUILE, 2800), { qte: "2" });
  it("montant automatique d'un PU du catalogue : converti, rien à confirmer ; montant tapé ou PU tapé : à confirmer", () => {
    expect(montantNonConverti(catalogue, 2800)).toBe(false);
    expect(montantNonConverti(avecChangement(catalogue, { montant: "9" }), 2800)).toBe(true);
    expect(montantNonConverti(avecChangement({ ...vide("USD"), qte: "2" }, { pu: "3" }), 2800)).toBe(true);
    expect(montantNonConverti(catalogue, 0)).toBe(true); // sans taux, rien n'est converti
    expect(montantNonConverti(vide("USD"), 2800)).toBe(false); // pas de montant : rien à perdre
  });
  it("ne vise que les lignes qui changent réellement de devise, et se dit en clair", () => {
    const tapee = avecChangement(catalogue, { montant: "28" });
    expect(lignesAConfirmer([catalogue, tapee, { ...tapee, devise: "CDF" }], "CDF", 2800)).toEqual([tapee]);
    expect(phraseDevise(tapee, "CDF")).toBe("28,00 $ deviendra 28 FC");
  });
});

describe("brouillon repris : article disparu", () => {
  it("devient une ligne libre, désignation gardée ; un article connu reste", () => {
    const l = { ...vide("USD"), articleId: "zz", designation: "Vieux", puCatalogue: "1.5" };
    expect(sansArticleDisparu(l, () => false)).toMatchObject({ articleId: "", designation: "Vieux", puCatalogue: null });
    expect(sansArticleDisparu(l, () => true)).toBe(l);
  });
});
