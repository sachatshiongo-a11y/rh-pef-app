import { describe, it, expect } from "vitest";
import type { ConsommationReelle } from "@/lib/stock-restaurant";
import {
  dateLongue, enteteJour, feuilleExcel, ficheCommandeJournaliere, ficheRapportJournalier, partiePdf, semaineIso, texteCase,
} from "./fiches-conso";

/**
 * Fiches de l'onglet Consommation, d'après les classeurs de la Direction (2026-09-28) :
 * « PEF Rapport journalier cuisine et bar » et « PEF Commande Journalière ».
 */

const SEMAINE = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
const connue = (q: string, negative = false): ConsommationReelle => ({ etat: "CONNUE", quantite: q, negative, stockVeille: "0", recu: "0", compte: "0", veilleEstimee: false });
const inconnue: ConsommationReelle = { etat: "INCONNUE", raison: "PAS_DE_COMPTAGE" };

describe("dates des fiches", () => {
  it("semaine ISO (lundi → dimanche), jour abrégé + date, date longue", () => {
    expect(semaineIso("2026-02-16")).toBe(8); // en-tête du classeur « Rapport journalier » : semaine 8
    expect(semaineIso("2026-09-21")).toBe(39);
    expect(semaineIso("2026-09-27")).toBe(39);
    expect(semaineIso("2027-01-01")).toBe(53); // 2026 compte 53 semaines
    expect(semaineIso("2027-01-04")).toBe(1);
    expect(enteteJour("2026-09-21")).toBe("Lun 21/09");
    expect(enteteJour("2026-09-27")).toBe("Dim 27/09");
    expect(dateLongue("2026-09-22")).toBe("mardi 22 septembre 2026");
  });
});

describe("rapport journalier cuisine et bar", () => {
  const articles = [
    { id: "a", designation: "Coca", unite: "Bouteille", categorie: "Limonade et autre" },
    { id: "b", designation: "Fanta", unite: null, categorie: "Limonade et autre" },
    { id: "c", designation: "Castel", unite: "Bouteille", categorie: "Bière locale" },
    { id: "d", designation: "Glaçons", unite: "Sac", categorie: null },
  ];

  it("lundi → samedi, rubriques dans l'ordre reçu, unité avec la désignation, « — » pour l'inconnu", () => {
    const f = ficheRapportJournalier({
      espace: "BAR", jours: SEMAINE, articles,
      conso: (id, j) => (id === "a" && j === "2026-09-22" ? connue("12") : id === "c" && j === "2026-09-21" ? connue("-2", true) : inconnue),
    });
    expect(f.feuille).toBe("Bar");
    expect(f.titre).toBe("Rapport journalier bar — semaine 39");
    expect(f.enteteDesignation).toBe("Désignation/Date");
    expect(f.colonnes.map((c) => c.entete)).toEqual(["Lun 21/09", "Mar 22/09", "Mer 23/09", "Jeu 24/09", "Ven 25/09", "Sam 26/09"]);
    expect(f.sections.map((s) => s.titre)).toEqual(["Limonade et autre", "Bière locale", "Sans catégorie"]);
    const [coca, fanta] = f.sections[0]!.lignes;
    expect(coca!.designation).toBe("Coca (Bouteille)");
    expect(fanta!.designation).toBe("Fanta");
    expect(coca!.cases.map(texteCase)).toEqual(["—", "12", "—", "—", "—", "—"]);
    expect(f.sections[1]!.lignes[0]!.cases.map(texteCase)[0]).toBe("-2 (écart)");
  });

  it("le dimanche est ajouté s'il porte une consommation — jamais caché pour tenir dans le modèle", () => {
    const f = ficheRapportJournalier({ espace: "CUISINE", jours: SEMAINE, articles, conso: (id, j) => (id === "d" && j === "2026-09-27" ? connue("3") : inconnue) });
    expect(f.feuille).toBe("Cuisine");
    expect(f.colonnes.at(-1)!.entete).toBe("Dim 27/09");
    expect(f.sections.at(-1)!.lignes[0]!.cases.map(texteCase).at(-1)).toBe("3");
  });
});

describe("commande journalière", () => {
  const articles = [
    { id: "boeuf", designation: "Filet pur Boeuf", unite: "Kg", categorie: "Viande" },
    { id: "porc", designation: "Côtes de porc", unite: "Pièce", categorie: "Viande" },
    { id: "sucre", designation: "Sucre glace", unite: null, categorie: null },
  ];
  const commandes = new Map([["boeuf", 2.5]]);
  const livraisons = new Map([["boeuf", 2], ["sucre", 1]]);

  it("cuisine : Désignation/Date | Unité | Commande | Livraison ; vide = rien ; unité absente = « — » ; légumes en fin", () => {
    const f = ficheCommandeJournaliere({
      espace: "CUISINE", date: "2026-09-22", articles, commandes, livraisons,
      legumes: [{ designation: "Ail", unite: "Kg", commande: 3, livraison: 2.75 }, { designation: "Basilic", unite: "Botte", commande: null, livraison: null }],
    });
    expect(f.feuille).toBe("Fiche commande cuisine");
    expect(f.titre).toBe("Commande cuisine — semaine 39");
    expect([f.enteteDesignation, ...f.colonnes.map((c) => c.entete)]).toEqual(["Désignation/Date", "Unité", "Commande", "Livraison"]);
    expect(f.sections.map((s) => s.titre)).toEqual(["Viande", "À classer", "Légumes frais"]);
    const textes = f.sections.map((s) => s.lignes.map((l) => [l.designation, ...l.cases.map(texteCase)]));
    expect(textes[0]).toEqual([["Filet pur Boeuf", "Kg", "2,5", "2"], ["Côtes de porc", "Pièce", "", ""]]);
    expect(textes[1]).toEqual([["Sucre glace", "—", "", "1"]]);
    expect(textes[2]).toEqual([["Ail", "Kg", "3", "2,75"], ["Basilic", "Botte", "", ""]]);
  });

  it("bar : Désignation | Commande | Livraison, sans unité ni légumes", () => {
    const f = ficheCommandeJournaliere({ espace: "BAR", date: "2026-09-22", articles, commandes, livraisons, legumes: [{ designation: "Ail", unite: "Kg", commande: 1, livraison: 1 }] });
    expect(f.feuille).toBe("Fiche commande Bar");
    expect([f.enteteDesignation, ...f.colonnes.map((c) => c.entete)]).toEqual(["Désignation", "Commande", "Livraison"]);
    expect(f.sections.map((s) => s.titre)).not.toContain("Légumes frais");
    expect(f.sections[0]!.lignes[0]!.cases.map(texteCase)).toEqual(["2,5", "2"]);
  });

  it("PDF : textes au format maison, rubriques à part, couleurs commande / livraison ; Excel : nombres calculables", () => {
    const f = ficheCommandeJournaliere({ espace: "CUISINE", date: "2026-09-22", articles: [{ id: "x", designation: "Beurre", unite: null, categorie: "Crèmerie" }], commandes: new Map([["x", 1234.5]]), livraisons: new Map() });
    const p = partiePdf(f);
    expect(p.titre).toBe("Commande cuisine — semaine 39");
    expect(p.colonnes.map((c) => c.header)).toEqual(["Désignation/Date", "Unité", "Commande", "Livraison"]);
    expect(p.lignes).toEqual([["Crèmerie"], ["Beurre", "—", "1 234,5", ""]]);
    expect(p.sectionRows).toEqual([0]);
    expect([1, 2, 3].map((c) => p.couleurCellule!(1, c))).toEqual([undefined, "#1B7F3B", "#B42318"]);
    const x = feuilleExcel(f);
    expect(x.nom).toBe("Fiche commande cuisine");
    expect(x.entete).toEqual(["Désignation/Date", "Unité", "Commande", "Livraison"]);
    expect(x.lignes).toEqual([["Crèmerie"], ["Beurre", "—", 1234.5, ""]]);
    expect(x.sectionRows).toEqual([0]);
    expect(x.couleurTexteCellule(1, 2)).toBe("FF1B7F3B");
    expect(x.couleurTexteCellule(0, 2)).toBeUndefined(); // ligne de rubrique
  });
});
