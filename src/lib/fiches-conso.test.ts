import { describe, it, expect } from "vitest";
import type { ConsommationReelle } from "@/lib/stock-restaurant";
import {
  dateCourte, dateLongue, enteteJour, feuilleExcel, ficheCommandeJournaliere, ficheCommandeRemplie, fichesCommandeSemaine, nomFeuilleJour, nomImprime, ficheConsommationReelle, ficheRapportJournalier, partiePdf, semaineIso, texteCase,
} from "./fiches-conso";
import type { LigneVente } from "./ventes-journalieres";

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

describe("rapport journalier cuisine et bar : plats et boissons VENDUS", () => {
  const plat = (id: string, designation: string, rubrique: string, inactif = false): LigneVente => ({ cle: `fiche:${id}`, designation, rubrique, espace: "CUISINE", inactif });
  const lignes = [
    plat("duo", "Duo de capitaine et de saumon fumé", "Entrées froides"),
    plat("carbo", "Carbonara", "Pâtes classiques"),
    plat("bolo", "Bolognaise", "Pâtes classiques", true),
  ];
  const ventes = new Map([
    ["fiche:carbo_2026-09-21", 12],
    ["fiche:carbo_2026-09-22", 0], // saisi : rien vendu
    ["fiche:duo_2026-09-26", 3],
    ["fiche:bolo_2026-09-23", 1],
  ]);

  it("lundi → samedi, rubriques dans l'ordre reçu, « — » pour un jour non saisi, 0 saisi = 0", () => {
    const f = ficheRapportJournalier({ espace: "CUISINE", jours: SEMAINE, lignes, ventes });
    expect(f.feuille).toBe("Cuisine");
    expect(f.titre).toBe("Rapport journalier cuisine — semaine 39");
    expect(f.enteteDesignation).toBe("Désignation/Date");
    expect(f.colonnes.map((c) => c.entete)).toEqual(["Lun 21/09", "Mar 22/09", "Mer 23/09", "Jeu 24/09", "Ven 25/09", "Sam 26/09"]);
    expect(f.colonnes.every((c) => c.role === "vente")).toBe(true);
    expect(f.sections.map((s) => s.titre)).toEqual(["Entrées froides", "Pâtes classiques"]);
    const textes = f.sections.map((s) => s.lignes.map((l) => [l.designation, ...l.cases.map(texteCase)]));
    expect(textes[0]).toEqual([["Duo de capitaine et de saumon fumé", "—", "—", "—", "—", "—", "3"]]);
    expect(textes[1]).toEqual([
      ["Carbonara", "12", "0", "—", "—", "—", "—"],
      ["Bolognaise (désactivé)", "—", "—", "1", "—", "—", "—"],
    ]);
  });

  it("le dimanche s'ajoute dès qu'une vente y est saisie (même 0) — jamais caché pour tenir dans le modèle", () => {
    const f = ficheRapportJournalier({ espace: "BAR", jours: SEMAINE, lignes: [{ cle: "resto:coca", designation: "Coca Cola", rubrique: "Limonade et autre", espace: "BAR", inactif: false }], ventes: new Map([["resto:coca_2026-09-27", 0]]) });
    expect(f.feuille).toBe("Bar");
    expect(f.titre).toBe("Rapport journalier bar — semaine 39");
    expect(f.colonnes.at(-1)!.entete).toBe("Dim 27/09");
    expect(f.sections[0]!.lignes[0]!.cases.map(texteCase)).toEqual(["—", "—", "—", "—", "—", "—", "0"]);
  });

  it("une vente d'une ligne absente du rapport ne fait pas apparaître le dimanche", () => {
    const f = ficheRapportJournalier({ espace: "CUISINE", jours: SEMAINE, lignes, ventes: new Map([["fiche:autre_2026-09-27", 4]]) });
    expect(f.colonnes).toHaveLength(6);
  });

  it("PDF : « — » discret, nombres colorés ; Excel : nombres calculables, « — » en texte", () => {
    const f = ficheRapportJournalier({ espace: "CUISINE", jours: SEMAINE, lignes, ventes });
    const p = partiePdf(f);
    expect(p.lignes[3]).toEqual(["Carbonara", "12", "0", "—", "—", "—", "—"]);
    expect(p.sectionRows).toEqual([0, 2]);
    expect(p.couleurCellule!(3, 1)).toBe("#0F766E");
    expect(p.couleurCellule!(3, 2)).toBe("#0F766E"); // 0 est une saisie : coloré comme un nombre
    expect(p.couleurCellule!(3, 3)).toBeUndefined();
    const x = feuilleExcel(f);
    expect(x.lignes[3]).toEqual(["Carbonara", 12, 0, "—", "—", "—", "—"]);
    expect(x.couleurTexteCellule(3, 1)).toBe("FF0F766E");
  });
});

describe("consommation réelle du restaurant (l'ancien contenu du rapport journalier)", () => {
  const articles = [
    { id: "a", designation: "Coca", unite: "Bouteille", categorie: "Limonade et autre" },
    { id: "b", designation: "Fanta", unite: null, categorie: "Limonade et autre" },
    { id: "c", designation: "Castel", unite: "Bouteille", categorie: "Bière locale" },
    { id: "d", designation: "Glaçons", unite: "Sac", categorie: null },
  ];

  it("lundi → samedi, rubriques dans l'ordre reçu, unité avec la désignation, « — » pour l'inconnu", () => {
    const f = ficheConsommationReelle({
      espace: "BAR", jours: SEMAINE, articles,
      conso: (id, j) => (id === "a" && j === "2026-09-22" ? connue("12") : id === "c" && j === "2026-09-21" ? connue("-2", true) : inconnue),
    });
    expect(f.feuille).toBe("Conso. réelle bar");
    expect(f.titre).toBe("Consommation réelle bar — semaine 39");
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
    const f = ficheConsommationReelle({ espace: "CUISINE", jours: SEMAINE, articles, conso: (id, j) => (id === "d" && j === "2026-09-27" ? connue("3") : inconnue) });
    expect(f.feuille).toBe("Conso. réelle cuisine");
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

  it("cuisine : Désignation/Date | Unité | Commande | Livraison ; vide = rien ; unité absente = « — » ; rubriques du classeur d'abord", () => {
    const f = ficheCommandeJournaliere({
      espace: "CUISINE", date: "2026-09-22", articles, commandes, livraisons,
      legumes: [{ designation: "Ail", unite: "Kg", commande: 3, livraison: 2.75 }, { designation: "Basilic", unite: "Botte", commande: null, livraison: null }],
    });
    expect(f.feuille).toBe("Fiche commande cuisine");
    expect(f.titre).toBe("Commande cuisine — semaine 39");
    expect([f.enteteDesignation, ...f.colonnes.map((c) => c.entete)]).toEqual(["Désignation/Date", "Unité", "Commande", "Livraison"]);
    // « Fruits & Légumes frais » est une rubrique du classeur : elle passe avant « Viande » (inconnue).
    expect(f.sections.map((s) => s.titre)).toEqual(["Fruits & Légumes frais", "Viande", "À classer"]);
    const textes = f.sections.map((s) => s.lignes.map((l) => [l.designation, ...l.cases.map(texteCase)]));
    expect(textes[0]).toEqual([["Ail", "Kg", "3", "2,75"], ["Basilic", "Botte", "", ""]]);
    expect(textes[1]).toEqual([["Côtes de porc", "Pièce", "", ""], ["Filet pur Boeuf", "Kg", "2,5", "2"]]);
    expect(textes[2]).toEqual([["Sucre glace", "—", "", "1"]]);
  });

  it("bar : Désignation | Commande | Livraison, sans unité ni légumes", () => {
    const f = ficheCommandeJournaliere({ espace: "BAR", date: "2026-09-22", articles, commandes, livraisons, legumes: [{ designation: "Ail", unite: "Kg", commande: 1, livraison: 1 }] });
    expect(f.feuille).toBe("Fiche commande Bar");
    expect([f.enteteDesignation, ...f.colonnes.map((c) => c.entete)]).toEqual(["Désignation", "Commande", "Livraison"]);
    expect(f.sections.map((s) => s.titre)).not.toContain("Fruits & Légumes frais");
    expect(f.sections[0]!.lignes.map((l) => [l.designation, ...l.cases.map(texteCase)])).toEqual([["Côtes de porc", "", ""], ["Filet pur Boeuf", "2,5", "2"]]);
  });

  it("noms COURTS : saisi au catalogue, sinon l'article du restaurant rattaché s'il est seul, sinon la désignation", () => {
    expect(nomImprime({ designation: "Lamb Rack 1kg", nomCourt: " Carré d'agneau ", nomsRestaurant: ["Agneau"] })).toBe("Carré d'agneau");
    expect(nomImprime({ designation: "Spaghetti Lm Chef 12 X 1KG", nomCourt: null, nomsRestaurant: ["Spaghetti"] })).toBe("Spaghetti");
    expect(nomImprime({ designation: "Crème 1L", nomCourt: "", nomsRestaurant: ["Crème A", "Crème B"] })).toBe("Crème 1L");
    expect(nomImprime({ designation: "Vim", nomsRestaurant: [] })).toBe("Vim");
  });

  it("modèle du classeur : rang et rubrique du classeur, sous-rubrique sous sa rubrique, article non coché (mais commandé) en fin de rubrique", () => {
    const V = "Viande -Volaille-Poisson-Crustacé";
    const f = ficheCommandeJournaliere({
      espace: "CUISINE", date: "2026-09-22", livraisons: new Map(), commandes: new Map([["hors", 2]]),
      articles: [
        { id: "cailles", designation: "Cailles", unite: "Pièce", categorie: "Volailles", surFicheCommande: true, ordreCommande: 6, rubriqueCommande: `${V} — 2. Volaille` },
        { id: "agneau", designation: "Lamb Rack", nomCourt: "Carré d'agneau", unite: "Kg", categorie: "Viande", surFicheCommande: true, ordreCommande: 1, rubriqueCommande: `${V} — 1. Viande Rouge` },
        { id: "hachee", designation: "Viande Hachée", unite: "Kg", categorie: "Viande", surFicheCommande: true, ordreCommande: 4, rubriqueCommande: `${V} — 1. Viande Rouge` },
        { id: "hors", designation: "Agneau entier", unite: "Kg", categorie: "Viande", surFicheCommande: false, rubriqueCommande: null },
        { id: "beurre", designation: "Beurre", unite: "Unité", categorie: "Crèmerie-Fromagerie", surFicheCommande: true, ordreCommande: 28, rubriqueCommande: "Crèmerie-Fromagerie" },
        // Orthographe du classeur (« assaisonements ») : rangée par son rang, pas par son nom.
        { id: "curry", designation: "Curry", unite: "g", categorie: "Épices", surFicheCommande: true, ordreCommande: 91, rubriqueCommande: "Epices et assaisonements" },
        { id: "vim", designation: "Vim", unite: "Boîte", categorie: "Entretien", surFicheCommande: true, ordreCommande: 180, rubriqueCommande: "Produits d'entretien & Autre non-alimentaire" },
      ],
    });
    expect(f.sections.map((s) => [s.titre, s.lignes.map((l) => l.designation)])).toEqual([
      [V, []], // la rubrique du classeur, au-dessus de ses sous-rubriques
      ["1. Viande Rouge", ["Carré d'agneau", "Viande Hachée"]],
      ["2. Volaille", ["Cailles"]],
      ["Crèmerie-Fromagerie", ["Beurre"]],
      ["Epices et assaisonements", ["Curry"]],
      ["Produits d'entretien & Autre non-alimentaire", ["Vim"]],
      ["Viande", ["Agneau entier"]], // pas sur la fiche, mais commandé ce jour : imprimé, jamais perdu
    ]);
    const p = partiePdf(f);
    expect(p.lignes[0]).toEqual([V]);
    // Un article rangé sous « Fruits & Légumes frais » et les légumes : une seule rubrique.
    const g = ficheCommandeJournaliere({
      espace: "CUISINE", date: "2026-09-22", commandes: new Map(), livraisons: new Map(),
      articles: [{ id: "x", designation: "Salade Lolo", unite: "Kg", categorie: null, surFicheCommande: true, ordreCommande: 70, rubriqueCommande: "Fruits & Légumes frais" }],
      legumes: [{ designation: "Ail", unite: "Kg", commande: null, livraison: null }],
    });
    expect(g.sections.map((s) => [s.titre, s.lignes.map((l) => l.designation)])).toEqual([["Fruits & Légumes frais", ["Salade Lolo", "Ail"]]]);
    expect(p.sectionRows).toEqual([0, 1, 4, 6, 8, 10, 12]);
  });

  it("bar : rubriques dans l'ordre du classeur (Eau, Limonade, Bière locale…), inconnues ensuite", () => {
    const f = ficheCommandeJournaliere({
      espace: "BAR", date: "2026-09-22", commandes: new Map(), livraisons: new Map(),
      articles: [
        { id: "1", designation: "Tembo", unite: null, categorie: "Bière locale" },
        { id: "2", designation: "Cognac X", unite: null, categorie: "Spiritueux divers" },
        { id: "3", designation: "Coca Cola", unite: null, categorie: "Limonade et autre" },
        { id: "4", designation: "Dasani", unite: null, categorie: "Eau plate et petillante" },
      ],
    });
    expect(f.sections.map((s) => s.titre)).toEqual(["Eau plate et petillante", "Limonade et autre", "Bière locale", "Spiritueux divers"]);
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

describe("commande journalière de toute la semaine", () => {
  const articles = [{ id: "boeuf", designation: "Filet pur Boeuf", unite: "Kg", categorie: "Viande" }, { id: "castel", designation: "Castel", unite: null, categorie: "Bière" }];
  const vide = new Map<string, number>();
  const jour = (date: string, cmd = vide, liv = vide) => ({
    date,
    fiches: (["CUISINE", "BAR"] as const).map((espace) => ficheCommandeJournaliere({ espace, date, articles, commandes: cmd, livraisons: liv })),
  });
  const semaine = (dimanche: ReturnType<typeof jour>) => [
    jour("2026-09-28", new Map([["boeuf", 2]])), jour("2026-09-29"), jour("2026-09-30"), jour("2026-10-01"), jour("2026-10-02"), jour("2026-10-03"), dimanche,
  ];

  it("en-tête du classeur : « Date : JJ/MM/AAAA » sous le titre « … — semaine N », repris dans le PDF et l'Excel", () => {
    expect(dateCourte("2026-09-02")).toBe("02/09/2026");
    const f = jour("2026-09-29").fiches[0]!;
    expect(f.titre).toBe("Commande cuisine — semaine 40");
    expect(f.sousTitre).toBe("Date : 29/09/2026");
    expect(partiePdf(f)).toMatchObject({ titre: "Commande cuisine — semaine 40", sousTitre: "Date : 29/09/2026" });
    expect(feuilleExcel(f).titre).toBe("Commande cuisine — semaine 40 — Date : 29/09/2026");
    // Les autres fiches n'ont pas de sous-titre : rien ne change pour elles.
    expect("sousTitre" in partiePdf({ ...f, sousTitre: undefined })).toBe(false);
  });

  it("fiche remplie = au moins une quantité commandée OU livrée ; l'unité ne compte pas", () => {
    expect(ficheCommandeRemplie(jour("2026-10-04").fiches[0]!)).toBe(false); // unité « Kg » seule
    expect(ficheCommandeRemplie(jour("2026-10-04", new Map([["boeuf", 1]])).fiches[0]!)).toBe(true);
    expect(ficheCommandeRemplie(jour("2026-10-04", vide, new Map([["castel", 6]])).fiches[1]!)).toBe(true);
  });

  it("noms de feuille « Lun 28 Cuisine », « Jeu 1 Bar » : 31 caractères au plus", () => {
    expect(nomFeuilleJour("2026-09-28", "CUISINE")).toBe("Lun 28 Cuisine");
    expect(nomFeuilleJour("2026-10-01", "BAR")).toBe("Jeu 1 Bar");
    expect(nomFeuilleJour("2026-10-04", "CUISINE")).toBe("Dim 4 Cuisine");
    for (let i = 0; i < 7; i++) for (const e of ["CUISINE", "BAR"] as const) expect(nomFeuilleJour(`2026-09-${String(21 + i).padStart(2, "0")}`, e).length).toBeLessThanOrEqual(31);
  });

  it("lundi → samedi ; le dimanche vide est omis, jamais un jour de semaine vide", () => {
    const r = fichesCommandeSemaine(semaine(jour("2026-10-04")), ["CUISINE", "BAR"]);
    expect(r.map((j) => j.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(r.flatMap((j) => j.fiches.map((f) => f.feuille))).toEqual(
      ["Lun 28", "Mar 29", "Mer 30", "Jeu 1", "Ven 2", "Sam 3"].flatMap((j) => [`${j} Cuisine`, `${j} Bar`]),
    );
    // Cuisine puis Bar, chaque jour ; le contenu de la fiche n'est pas touché.
    expect(r[0]!.fiches.map((f) => f.titre)).toEqual(["Commande cuisine — semaine 40", "Commande bar — semaine 40"]);
  });

  it("le dimanche apparaît dès qu'une de ses fiches porte une commande ou une livraison", () => {
    const r = fichesCommandeSemaine(semaine(jour("2026-10-04", vide, new Map([["castel", 6]]))), ["CUISINE", "BAR"]);
    expect(r.map((j) => j.date).at(-1)).toBe("2026-10-04");
    expect(r.at(-1)!.fiches.map((f) => f.feuille)).toEqual(["Dim 4 Cuisine", "Dim 4 Bar"]);
    // Filtre de l'écran (Bar seul) : les noms suivent l'espace demandé.
    const bar = fichesCommandeSemaine(semaine(jour("2026-10-04")).map((j) => ({ date: j.date, fiches: [j.fiches[1]!] })), ["BAR"]);
    expect(bar.map((j) => j.fiches[0]!.feuille)).toEqual(["Lun 28 Bar", "Mar 29 Bar", "Mer 30 Bar", "Jeu 1 Bar", "Ven 2 Bar", "Sam 3 Bar"]);
  });
});
