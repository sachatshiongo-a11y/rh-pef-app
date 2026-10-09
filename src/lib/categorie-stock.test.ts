import { describe, it, expect } from "vitest";
import { doublonDeCategorie, messageDoublonCategorie, nomCategorieNet } from "./categorie-stock";

// Anti-doublon d'une catégorie du stock : la règle de l'article (casse, accents, espaces, pluriel, ordre
// des mots) dans le MÊME domaine, catégories archivées comprises, avec un seuil relevé pour laisser passer
// les catégories sœurs (« Boissons chaudes » / « Boissons froides »).
const cat = (id: string, nom: string, domaine = "NOURRITURE", actif = true) => ({ id, nom, domaine, actif });
const LISTE = [cat("1", "Tomates"), cat("2", "Boissons chaudes", "BOISSON"), cat("3", "Surgelés", "NOURRITURE", false)];

describe("doublonDeCategorie", () => {
  it.each(["Tomates", "tomates", "  TOMATES ", "Tomate", "Tomatés"])("« %s » est le doublon de « Tomates »", (nom) => {
    expect(doublonDeCategorie(nom, "NOURRITURE", LISTE)?.categorie.id).toBe("1");
  });
  it("distingue le nom identique (exact) du nom proche", () => {
    expect(doublonDeCategorie("tomates", "NOURRITURE", LISTE)?.exact).toBe(true);
    expect(doublonDeCategorie("Tomate", "NOURRITURE", LISTE)?.exact).toBe(false);
  });
  it("ne regarde que le même domaine", () => {
    expect(doublonDeCategorie("Tomates", "BOISSON", LISTE)).toBeNull();
  });
  it("s'exclut elle-même (renommage : changement de casse permis)", () => {
    expect(doublonDeCategorie("TOMATES", "NOURRITURE", LISTE, "1")).toBeNull();
  });
  it("laisse passer les catégories sœurs et les noms distincts", () => {
    expect(doublonDeCategorie("Boissons froides", "BOISSON", LISTE)).toBeNull();
    expect(doublonDeCategorie("Viandes", "NOURRITURE", LISTE)).toBeNull();
  });
  it("compte les catégories archivées", () => {
    expect(doublonDeCategorie("surgeles", "NOURRITURE", LISTE)?.categorie.actif).toBe(false);
  });
});

describe("messageDoublonCategorie", () => {
  it("nomme la catégorie existante et son domaine ; dit de réactiver une archivée", () => {
    expect(messageDoublonCategorie("Tomate", { categorie: LISTE[0], exact: false })).toBe("« Tomate » ressemble trop à la catégorie « Tomates » (Nourriture). Utilisez-la plutôt. Rien n'a été enregistré.");
    expect(messageDoublonCategorie("surgeles", { categorie: LISTE[2], exact: true })).toContain("réactivez-la plutôt");
  });
});

describe("nomCategorieNet", () => {
  it("retire les espaces de bord et réduit les espaces internes", () => {
    expect(nomCategorieNet("  Produits \t laitiers ")).toBe("Produits laitiers");
  });
});
