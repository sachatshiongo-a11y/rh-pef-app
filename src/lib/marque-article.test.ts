import { describe, it, expect } from "vitest";
import { libelleArticle } from "./libelle-article";
import { marquesDifferentes, memeArticle, type ArticleCandidat } from "./achats-doublons";
import { decisionArticle, prochesDansListe } from "./article-proche";
import { filtrerOptions, optionsArticles } from "./recherche-options";
import { articleDansFiltre, FILTRE_INVENTAIRE_VIDE } from "./filtre-inventaire";
import { alternativeMoinsChere, type ArticlePrix } from "./fiches/moins-cher";
import { nomLigne, type ArticleOption } from "@/app/(stock)/stock/fiches/_data/fiche-calc";

// MARQUE des articles (Direction, 2026-10-14) : « Beurre doux Président 250 g ». Le libellé est CALCULÉ,
// la désignation en base n'est jamais réécrite ; deux marques renseignées différentes = deux articles.

describe("libelleArticle avec marque", () => {
  it("la marque s'insère AVANT la contenance enregistrée", () => {
    expect(libelleArticle({ designation: "Beurre doux", marque: "Président", contenance: "250", contenanceUnite: "g" })).toBe("Beurre doux Président 250 g");
  });
  it("la marque s'insère avant la contenance écrite dans le nom", () => {
    expect(libelleArticle({ designation: "Beurre doux 250 g", marque: "Président", contenance: "250", contenanceUnite: "g" })).toBe("Beurre doux Président 250 g");
    expect(libelleArticle({ designation: "Absolut Vodka-70cl", marque: "Pernod", contenance: "70", contenanceUnite: "cl" })).toBe("Absolut Vodka Pernod 70cl");
  });
  it("sans contenance : à la fin ; sans marque : comme avant", () => {
    expect(libelleArticle({ designation: "Beurre doux", marque: "Président" })).toBe("Beurre doux Président");
    expect(libelleArticle({ designation: "Beurre doux", marque: null, contenance: "250", contenanceUnite: "g" })).toBe("Beurre doux 250 g");
    expect(libelleArticle({ designation: "Beurre doux", marque: "  " })).toBe("Beurre doux");
  });
  it("marque déjà dans le nom (casse et accents ignorés) : jamais répétée", () => {
    expect(libelleArticle({ designation: "Beurre doux Président", marque: "president" })).toBe("Beurre doux Président");
    expect(libelleArticle({ designation: "PRESIDENT beurre doux 250g", marque: "Président", contenance: "250", contenanceUnite: "g" })).toBe("PRESIDENT beurre doux 250g");
  });
});

const cat = (id: string, designation: string, marque: string | null = null, extra: Partial<ArticleCandidat> = {}): ArticleCandidat => ({ id, designation, marque, unite: "kg", domaine: "NOURRITURE", prix: null, actif: true, ...extra });

describe("anti-doublon et marque", () => {
  it("marquesDifferentes : seulement deux marques renseignées et différentes", () => {
    expect(marquesDifferentes("Président", "Lurpak")).toBe(true);
    expect(marquesDifferentes("Président", " président ")).toBe(false);
    expect(marquesDifferentes("Président", null)).toBe(false);
    expect(marquesDifferentes("", "Lurpak")).toBe(false);
  });
  it("memeArticle : même désignation ET pas deux marques différentes", () => {
    expect(memeArticle("Beurre doux", "Lurpak", { designation: "beurre DOUX", marque: "Président" })).toBe(false);
    expect(memeArticle("Beurre doux", "Président", { designation: "beurre DOUX", marque: "président" })).toBe(true);
    expect(memeArticle("Beurre doux", null, { designation: "Beurre doux", marque: "Président" })).toBe(true); // règle d'avant
  });
  it("même désignation, marque différente : un NOUVEL article, pas un doublon", () => {
    const catalogue = [cat("1", "Beurre doux", "Président")];
    expect(decisionArticle("Beurre doux", catalogue, "Lurpak")).toEqual({ type: "nouveau" });
  });
  it("même désignation, même marque : rattaché à l'existant ; sans marque : comme avant", () => {
    const catalogue = [cat("1", "Beurre doux", "Président")];
    expect(decisionArticle("beurre doux", catalogue, "président")).toEqual({ type: "auto", article: catalogue[0] });
    expect(decisionArticle("Beurre doux", catalogue)).toEqual({ type: "auto", article: catalogue[0] });
  });
  it("deux lignes du même nom et de marques différentes dans une liste ne sont pas des noms proches", () => {
    const creera = () => true;
    expect(prochesDansListe(["Beurre doux", "Beurre doux"], creera, ["Président", "Lurpak"]).size).toBe(0);
    expect(prochesDansListe(["Beurre doux", "Beurre doux léger"], creera, ["Président", "Lurpak"]).size).toBe(0);
    expect(prochesDansListe(["Beurre doux", "Beurre douxs"], creera, [null, null]).size).toBe(1);
  });
});

describe("recherche par marque", () => {
  const articles = [
    { id: "1", designation: "Beurre doux", marque: "Président", actif: true, contenance: "250", contenanceUnite: "g" },
    { id: "2", designation: "Beurre doux", marque: "Lurpak", actif: true, contenance: "250", contenanceUnite: "g" },
    { id: "3", designation: "Farine T55", marque: null, actif: true },
  ];
  it("le sélecteur d'articles retrouve par la marque et affiche le nom complet", () => {
    const options = optionsArticles(articles);
    expect(options.map((o) => o.libelle)).toEqual(["Beurre doux Président 250 g", "Beurre doux Lurpak 250 g", "Farine T55"]);
    expect(filtrerOptions(options, "lurpak").map((o) => o.id)).toEqual(["2"]);
    expect(filtrerOptions(options, "PRESIDENT").map((o) => o.id)).toEqual(["1"]);
    expect(filtrerOptions(options, "beurre").map((o) => o.id).sort()).toEqual(["1", "2"]);
  });
  it("le filtre de l'Inventaire retrouve par la marque", () => {
    const a = { designation: "Beurre doux", marque: "Lurpak", code: "12", niveau: "OK" as const, haussePct: null, prix: "2", fournisseurId: "f1", stockMinimum: "5", unite: "kg", quantite: "10" };
    expect(articleDansFiltre(a, { ...FILTRE_INVENTAIRE_VIDE, q: "lurpak" })).toBe(true);
    expect(articleDansFiltre({ ...a, marque: "Président" }, { ...FILTRE_INVENTAIRE_VIDE, q: "lurpak" })).toBe(false);
  });
});

const prix = (id: string, marque: string | null, prixUnitaireUSD: string | null, extra: Partial<ArticlePrix> = {}): ArticlePrix => ({ id, designation: "Beurre doux", marque, unite: "kg", prixUnitaireUSD, actif: true, ...extra });

describe("fiche technique : libellé et signal « revient moins cher »", () => {
  it("l'ingrédient s'écrit avec sa marque (écran, PDF et Excel passent par nomLigne)", () => {
    const articles = new Map([["a1", { designation: "Beurre doux", marque: "Président", contenance: "250", contenanceUnite: "g" }]]);
    expect(nomLigne({ id: "l", articleId: "a1", sousFicheId: null, unite: "g", quantite: "10", ordre: 0 }, 0, articles, new Map())).toBe("Beurre doux Président 250 g");
  });
  it("une autre marque moins chère est signalée, au prix ramené à l'unité de l'ingrédient", () => {
    const p = prix("1", "Président", "12");
    const l = prix("2", "Lurpak", "9");
    const r = alternativeMoinsChere(p, "g", [p, l]);
    expect(r).toMatchObject({ articleId: "2", marque: "Lurpak", unite: "kg", approx: false });
    expect(Number(r!.prix)).toBeCloseTo(9, 9);
    expect(Number(r!.prixActuel)).toBeCloseTo(12, 9);
  });
  it("prix d'achat dans une autre unité : comparé à l'unité de l'ingrédient (sac de 500 g à 3 $ = 6 $/kg)", () => {
    const p = prix("1", "Président", "7");
    const l = prix("2", "Lurpak", "3", { unite: "500 GR" });
    const r = alternativeMoinsChere(p, "g", [p, l]);
    expect(Number(r!.prix)).toBeCloseTo(6, 9);
  });
  it("jamais de signal : même marque, marque absente, inactif, sans prix, plus cher, autre désignation, unité inconvertible", () => {
    const p = prix("1", "Président", "12");
    expect(alternativeMoinsChere(p, "g", [p, prix("2", "président", "5")])).toBeNull();
    expect(alternativeMoinsChere(p, "g", [p, prix("2", null, "5")])).toBeNull();
    expect(alternativeMoinsChere(p, "g", [p, prix("2", "Lurpak", "5", { actif: false })])).toBeNull();
    expect(alternativeMoinsChere(p, "g", [p, prix("2", "Lurpak", null)])).toBeNull();
    expect(alternativeMoinsChere(p, "g", [p, prix("2", "Lurpak", "0")])).toBeNull();
    expect(alternativeMoinsChere(p, "g", [p, prix("2", "Lurpak", "15")])).toBeNull();
    expect(alternativeMoinsChere(p, "g", [p, prix("2", "Lurpak", "5", { designation: "Beurre salé" })])).toBeNull();
    expect(alternativeMoinsChere(p, "pièce", [p, prix("2", "Lurpak", "5")])).toBeNull();
    expect(alternativeMoinsChere(prix("1", "Président", null), "g", [prix("2", "Lurpak", "5")])).toBeNull();
  });
  it("la moins chère l'emporte ; un article en francs rend le signal approché (≈)", () => {
    const p = prix("1", "Président", "12");
    const r = alternativeMoinsChere(p, "g", [p, prix("2", "Lurpak", "9"), prix("3", "Elle & Vire", "8", { prixApprox: true })]);
    expect(r).toMatchObject({ articleId: "3", marque: "Elle & Vire", approx: true });
  });
  it("à la pièce, deux contenances différentes ne se comparent pas", () => {
    const p = prix("1", "Président", "2", { unite: "pièce", contenance: "250", contenanceUnite: "g" });
    const moinsCherAutreTaille = prix("2", "Lurpak", "1", { unite: "pièce", contenance: "500", contenanceUnite: "g" });
    const memeTaille = prix("3", "Elle & Vire", "1.5", { unite: "pièce", contenance: "250", contenanceUnite: "g" });
    expect(alternativeMoinsChere(p, "pièce", [p, moinsCherAutreTaille])).toBeNull();
    expect(alternativeMoinsChere(p, "pièce", [p, moinsCherAutreTaille, memeTaille])).toMatchObject({ articleId: "3", unite: "pièce" });
  });
  it("le signal ne touche pas l'article de la ligne (type ArticleOption inchangé, lecture seule)", () => {
    const p: ArticleOption = { id: "1", designation: "Beurre doux", marque: "Président", unite: "kg", prixUnitaireUSD: "12", actif: true };
    const avant = JSON.stringify(p);
    alternativeMoinsChere(p, "g", [p, { ...p, id: "2", marque: "Lurpak", prixUnitaireUSD: "9" }]);
    expect(JSON.stringify(p)).toBe(avant);
  });
});
