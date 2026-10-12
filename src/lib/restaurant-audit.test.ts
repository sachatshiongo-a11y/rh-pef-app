import { describe, it, expect } from "vitest";
import { calculerCout } from "@/lib/fiches/cout";
import { estUniteComptage, facteur, normaliserUnite } from "@/lib/fiches/conversion";
import { calculerDisponibilite, convertirDepuisUniteArticle } from "@/lib/fiches/disponibilite";
import { stockRestaurantTheorique, consommationReelle, consoApproximative, mentionDepuis, type ArticleRestoSR, type EntreesStockResto } from "@/lib/stock-restaurant";
import {
  consoApproximativeParArticleCatalogue, libelleAvecUnite, lignesComparaison, lignesExportComparaison, lignesExportConso, livreDiffereDuCommande, consommationsSemaine,
  sommeExacte, sortiesParMotif, totalConso, totauxParUnite,
} from "@/lib/journalier-restaurant";
import { achatsLegumesParLigne, lignesLegumesCommande, lignesLegumesComparaison } from "@/lib/legumes-semaine";
import { caseConso, texteCase, valeurExcel } from "@/lib/fiches-conso";

// Audit RESTAURANT du 10/10/2026 — la partie pure : une preuve par défaut corrigé, qui échoue sans
// le correctif (voir les rapports de falsification). Les parties qui touchent la base sont dans
// `src/app/(stock)/stock/restaurant/audit.integration.test.ts`.

describe("5. une seule normalisation d'unités (accents, « (s) », pluriel, casse)", () => {
  it("« Bouteille » = « Bouteille(s) » = « bouteilles » ; « pièce » = « Piece » = « PIÈCES »", () => {
    for (const u of ["Bouteille", "Bouteille(s)", "bouteilles", " BOUTEILLES ", "bouteille (s)"]) expect([u, normaliserUnite(u)]).toEqual([u, "bouteille"]);
    for (const u of ["pièce", "Piece", "PIÈCES", "Pièce(s)", "pieces"]) expect([u, normaliserUnite(u)]).toEqual([u, "pièce"]);
    for (const u of ["Boite", "boîtes", "Boîte(s)"]) expect([u, normaliserUnite(u)]).toEqual([u, "boîte"]);
    expect(normaliserUnite("Bottes")).toBe(normaliserUnite("botte"));
  });

  it("la conversion reconnaît les mêmes unités que la liste des unités de comptage", () => {
    for (const u of ["Bouteille", "Bouteille(s)", "bouteilles", "Piece", "pièce", "Pièces"]) {
      expect([u, estUniteComptage(u)]).toEqual([u, true]);
      expect([u, facteur(u, "bouteille") !== null || facteur(u, "pièce") !== null]).toEqual([u, true]);
    }
    expect(facteur("Bouteille(s)", "bouteille")?.toString()).toBe("1");
    expect(facteur("Piece", "pièce")?.toString()).toBe("1");
    // Ce qui n'est PAS la même unité le reste : comptage ≠ comptage, masse ≠ comptage.
    expect(facteur("bouteille", "pièce")).toBeNull();
    expect(facteur("kg", "pièce")).toBeNull();
    expect(facteur("kg", "g")?.toString()).toBe("1000");
  });

  it("livraison du dépôt : « Bouteille(s) » au catalogue et « bouteilles » au restaurant s'additionnent", () => {
    expect(convertirDepuisUniteArticle("6", { unite: "Bouteille(s)" }, "bouteilles")).toBe("6");
    const vin: ArticleRestoSR = { id: "v", designation: "Vin", espace: "BAR", unite: "bouteilles", rattaches: [{ id: "cat-vin", unite: "Bouteille(s)" }] };
    const e: EntreesStockResto = {
      articles: [vin],
      comptages: [{ articleRestoId: "v", date: "2026-09-20", quantite: "4" }],
      livraisons: [{ id: "l1", articleStockId: "cat-vin", designation: "Vin", uniteCatalogue: "Bouteille(s)", date: "2026-09-21", quantite: "6", categorieSortie: "LIVRAISON_RESTAURANT" }],
    };
    const s = stockRestaurantTheorique(e, "2026-09-22").parArticle.get("v")!;
    expect(s.signalements).toEqual([]);
    expect(s.stock).toBe("10");
  });

  it("coût de fiche : « Piece » consommée sur un article en « pièce » est valorisée, pas « partielle »", () => {
    const r = calculerCout(
      { id: "f", nom: "Plat", nbPortions: 1, tauxTVA: 0.16, estSousRecette: false, ingredients: [{ nom: "Citron", quantite: 3, unite: "Piece", article: { prixUnitaireUSD: 0.5, unite: "pièce" } }] },
      { fiches: new Map() },
    );
    expect(r.incomplet).toBe(false);
    expect(r.coutTotal.toString()).toBe("1.5");
    const r2 = calculerCout(
      { id: "g", nom: "Plat", nbPortions: 1, tauxTVA: 0.16, estSousRecette: false, ingredients: [{ nom: "Vin", quantite: 2, unite: "bouteilles", article: { prixUnitaireUSD: 10, unite: "Bouteille(s)" } }] },
      { fiches: new Map() },
    );
    expect(r2.incomplet).toBe(false);
    expect(r2.coutTotal.toString()).toBe("20");
  });
});

describe("3. consommation sur plusieurs jours : « depuis le JJ/MM (N jours) » et « ≈ »", () => {
  const farine: ArticleRestoSR = { id: "f", designation: "Farine", espace: "CUISINE", unite: "kg", rattaches: [] };
  const e: EntreesStockResto = {
    articles: [farine],
    comptages: [
      { articleRestoId: "f", date: "2026-10-05", quantite: "10" },
      { articleRestoId: "f", date: "2026-10-08", quantite: "4" }, // 6 kg consommés sur 3 jours (veille 07 non comptée)
      { articleRestoId: "f", date: "2026-10-09", quantite: "3" }, // veille comptée : 1 jour
    ],
    livraisons: [],
  };

  it("la veille non comptée : la consommation dit depuis quand elle couvre", () => {
    const c = consommationReelle(e, "f", "2026-10-08");
    expect(c).toMatchObject({ etat: "CONNUE", quantite: "6", depuis: "2026-10-05", nbJours: 3, veilleEstimee: false });
    if (c.etat !== "CONNUE") throw new Error("attendu : connue");
    expect(consoApproximative(c)).toBe(true);
    expect(mentionDepuis(c)).toBe("depuis le 05/10 (3 jours)");
  });

  it("la veille comptée : un seul jour, pas de mention, pas de « ≈ »", () => {
    const c = consommationReelle(e, "f", "2026-10-09");
    expect(c).toMatchObject({ etat: "CONNUE", quantite: "1", depuis: null, nbJours: 1 });
    if (c.etat !== "CONNUE") throw new Error("attendu : connue");
    expect(consoApproximative(c)).toBe(false);
    expect(mentionDepuis(c)).toBeNull();
  });

  it("export de la consommation (PDF / Excel du classeur) : « ≈ 6 depuis le 05/10 (3 jours) », total « ≈ »", () => {
    const jours = ["2026-10-08", "2026-10-09"];
    const lignes = consommationsSemaine(e, jours);
    const r = lignesExportConso({ sorties: sortiesParMotif([], jours), legumes: [], consoResto: lignes });
    expect(r.lignes.at(-1)).toEqual(["Farine (kg)", "≈ 6 depuis le 05/10 (3 jours)", "1", "≈ 7"]);
    expect(totalConso(lignes[0]!.jours)).toBe("≈ 7");
  });

  it("fiche « Consommation réelle » (PDF et Excel) : la case porte « ≈ » et sa mention", () => {
    const [c] = consommationsSemaine(e, ["2026-10-08"]);
    const cc = caseConso(c!.jours[0]!);
    expect(cc).toMatchObject({ valeur: 6, approx: "depuis le 05/10 (3 jours)" });
    expect(texteCase(cc)).toBe("≈ 6 depuis le 05/10 (3 jours)");
    expect(valeurExcel(cc)).toBe("≈ 6 depuis le 05/10 (3 jours)"); // du texte : un chiffre calculable sans son ≈ passerait pour exact
    const [exacte] = consommationsSemaine(e, ["2026-10-09"]);
    expect(texteCase(caseConso(exacte!.jours[0]!))).toBe("1");
    expect(valeurExcel(caseConso(exacte!.jours[0]!))).toBe(1);
  });

  it("comparaison : le consommé de plusieurs jours est marqué « ≈ » (jamais comparé comme celui d'un jour)", () => {
    const x: EntreesStockResto = { ...e, articles: [{ ...farine, rattaches: [{ id: "cat-farine", unite: "kg" }] }] };
    const jours = ["2026-10-08", "2026-10-09"];
    const approx = consoApproximativeParArticleCatalogue(x, jours);
    expect(approx.get("cat-farine")).toEqual(["depuis le 05/10 (3 jours)", null]);
    const lignes = lignesComparaison({
      jours, articles: [{ id: "cat-farine", designation: "Farine", categorie: "Épicerie", unite: "kg" }], commandes: {}, livraisons: [],
      consoParArticle: new Map([["cat-farine", ["6", "1"]]]), consoApproxParArticle: approx, inclureHorsCatalogue: false,
    });
    const exp = lignesExportComparaison(lignes, ["Jeu 8", "Ven 9"]);
    expect(exp.lignes.at(-1)).toEqual(["Farine (kg)", "", "", "≈ 6", "", "", "1", "", "", "≈ 7"]);
  });
});

describe("4. l'unité du catalogue sur chaque ligne ; jamais des unités additionnées", () => {
  it("totauxParUnite : 12 kg et 5 bouteilles ne font pas 17 ; « Kg » = « kilos »", () => {
    const t = totauxParUnite([
      { unite: "kg", valeur: 10 }, { unite: "bouteille", valeur: 5 }, { unite: "Kg", valeur: 2 }, { unite: "Bouteille(s)", valeur: 1 }, { unite: null, valeur: 3 },
    ]);
    expect(t).toEqual([{ unite: "kg", total: 12 }, { unite: "bouteille", total: 6 }, { unite: null, total: 3 }]);
  });

  it("les exports portent l'unité sur la ligne (Consommation : livré ; Comparaison)", () => {
    const sorties = sortiesParMotif([{ articleId: "a", designation: "Farine", unite: "kg", date: "2026-10-05", quantite: 2, categorieSortie: "LIVRAISON_RESTAURANT" }], ["2026-10-05"]);
    expect(sorties.livraisons[0]).toMatchObject({ designation: "Farine", unite: "kg" });
    const r = lignesExportConso({ sorties, legumes: [{ nom: "Ail", unite: "Kg", jours: [1] }], consoResto: [] });
    expect(r.lignes.map((l) => l[0])).toEqual([expect.any(String), "Farine (kg)", "Légumes frais (achats du jour)", "Ail (Kg)"]);
    const comp = lignesComparaison({
      jours: ["2026-10-05"], articles: [{ id: "a", designation: "Farine", categorie: "Épicerie", unite: "kg" }, { id: "b", designation: "Eau", categorie: "Épicerie", unite: null }],
      commandes: { "a_2026-10-05": 3, "b_2026-10-05": 1 }, livraisons: [], consoParArticle: new Map(), inclureHorsCatalogue: false,
    });
    const exp = lignesExportComparaison(comp, ["Lun 5"]);
    expect(exp.lignes.map((l) => l[0])).toEqual(["Épicerie", "Eau", "Farine (kg)"]); // sans unité renseignée : le nom seul, jamais une unité inventée
    expect(libelleAvecUnite("Vin", " bouteille ")).toBe("Vin (bouteille)");
  });
});

describe("8. sommes en Decimal : plus de faux écart 0,1 + 0,2", () => {
  it("deux sorties de 0,1 et 0,2 font 0,3 exactement, et ne diffèrent pas d'une commande de 0,3", () => {
    const r = sortiesParMotif([
      { articleId: "a", designation: "Sel", date: "2026-10-05", quantite: 0.1, categorieSortie: "LIVRAISON_RESTAURANT" },
      { articleId: "a", designation: "Sel", date: "2026-10-05", quantite: 0.2, categorieSortie: "LIVRAISON_RESTAURANT" },
    ], ["2026-10-05"]);
    expect(r.livraisons[0]!.jours[0]).toBe(0.3);
    expect(r.livraisons[0]!.total).toBe(0.3);
    expect(livreDiffereDuCommande(0.3, r.livraisons[0]!.jours[0]!)).toBe(false);
    expect(0.1 + 0.2).not.toBe(0.3); // le piège que le correctif évite
    expect(sommeExacte([0.1, 0.2])).toBe(0.3);
    expect(livreDiffereDuCommande(0.3, 0.1 + 0.2)).toBe(false);
    expect(livreDiffereDuCommande(0.3, 0.4)).toBe(true);
    expect(livreDiffereDuCommande(0, 0)).toBe(false);
  });

  it("le total de la semaine d'une ligne de comparaison est exact", () => {
    const comp = lignesComparaison({
      jours: ["2026-10-05", "2026-10-06"], articles: [{ id: "a", designation: "Sel", categorie: "Épicerie" }],
      commandes: { "a_2026-10-05": 0.1, "a_2026-10-06": 0.2 }, livraisons: [], consoParArticle: new Map(), inclureHorsCatalogue: false,
    });
    const exp = lignesExportComparaison(comp, ["Lun 5", "Mar 6"]);
    expect(exp.lignes.at(-1)![7]).toBe("0,3"); // 7 = total Cmd
  });
});

describe("9. légumes : commande et achat d'unités différentes ne partagent jamais une ligne", () => {
  const liste = [{ nom: "Ail", unite: "Kg" }, { nom: "Menthe", unite: "Botte" }, { nom: "Tomates fraiches", unite: "Kg" }];

  it("fiche Commande : l'achat en « Sac » passe sur sa propre ligne, la commande reste en « Kg »", () => {
    const lignesAchat = [
      { designation: "Ail", unite: "Sac", quantite: 2 }, // achat dans une autre unité, seul : prend la ligne du légume
      { designation: "Menthe", unite: "Botte", quantite: 3 },
      { designation: "Tomates fraiches", unite: "Kg", quantite: null },
      { designation: "Gombo", unite: "Tas", quantite: 4 }, // hors liste
    ];
    const r = lignesLegumesCommande(lignesAchat, new Map([["Ail", 5], ["Menthe", 2]]), liste);
    expect(r).toEqual([
      { designation: "Ail", unite: "Kg", commande: 5, livraison: null },
      { designation: "Menthe", unite: "Botte", commande: 2, livraison: 3 },
      { designation: "Tomates fraiches", unite: "Kg", commande: null, livraison: null },
      { designation: "Ail", unite: "Sac", commande: null, livraison: 2 },
      { designation: "Gombo", unite: "Tas", commande: null, livraison: 4 },
    ]);
  });

  it("fiche Commande : « Bottes » et « Botte » sont la même unité (une seule ligne)", () => {
    const r = lignesLegumesCommande([{ designation: "Menthe", unite: "Bottes", quantite: 3 }], new Map([["Menthe", 2]]), [{ nom: "Menthe", unite: "Botte" }]);
    expect(r).toEqual([{ designation: "Menthe", unite: "Bottes", commande: 2, livraison: 3 }]);
  });

  it("Comparaison / Consommation : achats rangés par (légume, unité), sommes exactes", () => {
    const jours = ["2026-10-05", "2026-10-06"];
    const lignes = achatsLegumesParLigne([
      { legume: "Ail", unite: "kg", jour: "2026-10-05", quantite: 0.1 },
      { legume: "ail", unite: "Kg", jour: "2026-10-05", quantite: 0.2 },
      { legume: "Ail", unite: "Sac", jour: "2026-10-06", quantite: 1 },
      { legume: "Gombo", unite: null, jour: "2026-10-06", quantite: 2 },
      { legume: "Menthe", unite: null, jour: "2026-10-06", quantite: 1 }, // sans unité saisie : l'unité de la liste
    ], jours, liste);
    expect(lignes.map((l) => [l.id, l.unite, l.jours, l.total])).toEqual([
      ["legume:Ail", "Kg", [0.3, 0], 0.3],
      ["legume:Ail|sac", "Sac", [0, 1], 1],
      ["legume:Gombo", null, [0, 2], 2],
      ["legume:Menthe", "Botte", [0, 1], 1],
    ]);
    const cmp = lignesLegumesComparaison({ liste, achats: lignes, commandes: (nom) => (nom === "Ail" ? [0.3, 0] : [0, 0]), nbJours: 2 });
    expect(cmp.find((l) => l.id === "legume:Ail")).toMatchObject({ unite: "Kg", cmd: [0.3, 0], liv: [0.3, 0] });
    expect(cmp.find((l) => l.id === "legume:Ail|sac")).toMatchObject({ unite: "Sac", cmd: [0, 0], liv: [0, 1] });
    expect(cmp.find((l) => l.id === "legume:Gombo")).toMatchObject({ unite: null, cmd: [0, 0], liv: [0, 2] });
  });
});

describe("10. disponibilité : un dépôt négatif n'est pas masqué par le stock du restaurant", () => {
  it("dépôt −3 + restaurant 10 : « À vérifier » (stock négatif), jamais 7 portions", () => {
    const r = calculerDisponibilite(
      { id: "p", nom: "Pâtes", nbPortions: 1, estSousRecette: false, rendementQuantite: null, rendementUnite: null, ingredients: [{ nom: "Farine", unite: "kg", quantite: "1", articleId: "farine", sousFicheId: null }] },
      {
        fiches: new Map(),
        articles: new Map([["farine", { id: "farine", designation: "Farine", unite: "kg" }]]),
        stocks: new Map([["farine", { depot: "-3", restaurant: { etat: "OK" as const, quantite: "10", dateComptage: "2026-10-09" }, dernierMouvement: "2026-10-09" }]]),
      },
      "2026-10-10",
    );
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "STOCK_NEGATIF", ingredient: "Farine" }]);
    expect(r.portions).toBeNull();
  });
});
