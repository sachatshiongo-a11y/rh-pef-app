import { describe, it, expect } from "vitest";
import { calculerDisponibilite, type ArticleDispo, type FicheDispo, type StockArticle } from "@/lib/fiches/disponibilite";
import {
  depotsMutualises, etatRattachementLivraison, stockRestaurantPourDisponibilite, stockRestaurantTheorique,
  type ArticleCatalogueLie, type ArticleRestoSR, type EntreesStockResto, type LivraisonSR,
} from "@/lib/stock-restaurant";
import { consoApproximativeParArticleCatalogue, consommationParArticleCatalogue } from "@/lib/journalier-restaurant";

// Un article du restaurant rattaché à PLUSIEURS articles du catalogue (plusieurs marques de beurre) :
// les livraisons de n'importe laquelle alimentent son stock, chacune convertie dans l'unité du
// restaurant par la conversion unique ; la disponibilité somme le dépôt des marques.

const PRESIDENT: ArticleCatalogueLie = { id: "president", unite: "Pièce", contenance: "250", contenanceUnite: "g", designation: "Beurre Président 250 g" };
const LURPAK: ArticleCatalogueLie = { id: "lurpak", unite: "Pièce", contenance: "500", contenanceUnite: "g", designation: "Beurre Lurpak 500 g" };
const beurre = (...rattaches: ArticleCatalogueLie[]): ArticleRestoSR => ({ id: "beurre", designation: "Beurre", espace: "CUISINE", unite: "kg", rattaches });
const livraison = (l: ArticleCatalogueLie, date: string, quantite: string, id = `${l.id}-${date}`): LivraisonSR => ({
  id, articleStockId: l.id, designation: l.designation!, uniteCatalogue: l.unite, contenanceCatalogue: l.contenance, contenanceUniteCatalogue: l.contenanceUnite,
  date, quantite, categorieSortie: "LIVRAISON_RESTAURANT", domaine: "NOURRITURE",
});
const entrees = (articles: ArticleRestoSR[], livraisons: LivraisonSR[], comptage = "0.5"): EntreesStockResto => ({
  articles, comptages: [{ articleRestoId: "beurre", date: "2026-10-05", quantite: comptage }], livraisons,
});

describe("livraisons de plusieurs marques le même jour sur le même article du restaurant", () => {
  const e = entrees([beurre(PRESIDENT, LURPAK)], [livraison(PRESIDENT, "2026-10-06", "4"), livraison(LURPAK, "2026-10-06", "2")]);

  it("4 × 250 g + 2 × 500 g = 2 kg livrés : ajoutés au comptage de 0,5 kg, sans signalement", () => {
    const s = stockRestaurantTheorique(e, "2026-10-06").parArticle.get("beurre")!;
    expect(s.signalements).toEqual([]);
    expect(s.livraisonsDepuis.map((l) => [l.livraisonId, l.quantiteResto])).toEqual([["president-2026-10-06", "1"], ["lurpak-2026-10-06", "1"]]);
    expect(s.stock).toBe("2.5");
  });

  it("l'état d'une livraison de l'une ou l'autre marque : OK vers le même article ; une marque non rattachée reste « non rattachée »", () => {
    expect(etatRattachementLivraison("president", PRESIDENT, e.articles, "NOURRITURE")).toEqual({ etat: "OK", articleRestoId: "beurre" });
    expect(etatRattachementLivraison("lurpak", LURPAK, e.articles, "NOURRITURE")).toEqual({ etat: "OK", articleRestoId: "beurre" });
    expect(etatRattachementLivraison("vache", { unite: "Pièce" }, e.articles, "NOURRITURE")).toEqual({ etat: "NON_RATTACHE" });
  });

  it("retrait d'un rattachement : ses livraisons n'alimentent plus l'article (elles redeviennent « non rattachées »)", () => {
    const sans = entrees([beurre(PRESIDENT)], e.livraisons);
    const r = stockRestaurantTheorique(sans, "2026-10-06");
    expect(r.parArticle.get("beurre")!.stock).toBe("1.5"); // 0,5 + 1 kg du Président seulement
    expect(r.nonRattachees.map((l) => l.articleStockId)).toEqual(["lurpak"]);
  });

  it("une marque d'unité incompatible (au litre) est refusée, nommée, SANS bloquer l'autre", () => {
    const LAIT: ArticleCatalogueLie = { id: "creme", unite: "L", designation: "Crème liquide" };
    const x = entrees([beurre(PRESIDENT, LAIT)], [livraison(PRESIDENT, "2026-10-06", "4"), livraison(LAIT, "2026-10-06", "1")]);
    const s = stockRestaurantTheorique(x, "2026-10-06").parArticle.get("beurre")!;
    expect(s.stock).toBe("1.5");
    expect(s.signalements.map((g) => [g.motif, g.articleStockId])).toEqual([["UNITE_INCOMPATIBLE", "creme"]]);
  });

  it("disponibilité : le stock du restaurant est donné à CHAQUE marque dans SON unité (comptage 0,5 kg + 2 kg livrés = 10 pièces de 250 g, 5 de 500 g)", () => {
    const part = stockRestaurantPourDisponibilite(e, "2026-10-06");
    expect(part.get("president")).toMatchObject({ etat: "OK", quantite: "10", recu: "8", dateComptage: "2026-10-05" });
    expect(part.get("lurpak")).toMatchObject({ etat: "OK", quantite: "5", recu: "4", dateComptage: "2026-10-05" });
    // 4 Président (déjà en pièces de 250 g) + 2 Lurpak (= 4 pièces de 250 g) ; et 2 Lurpak + 4 Président (= 2 pièces de 500 g).
  });
});

describe("dépôt mutualisé des marques et disponibilité", () => {
  const articles = [beurre(PRESIDENT, LURPAK)];
  const FICHE: FicheDispo = {
    id: "p", nom: "Sauce", nbPortions: 1, estSousRecette: false, rendementQuantite: null, rendementUnite: null,
    ingredients: [{ nom: "Beurre Président", unite: "g", quantite: "250", articleId: "president", sousFicheId: null }],
  };
  const arts = new Map<string, ArticleDispo>([["president", { id: "president", designation: "Beurre Président 250 g", unite: "Pièce", contenance: "250", contenanceUnite: "g" }]]);
  const dispo = (stocks: Record<string, StockArticle>) => calculerDisponibilite(FICHE, { fiches: new Map(), articles: arts, stocks: new Map(Object.entries(stocks)) }, "2026-10-10");
  const dm = "2026-10-09";

  it("deux marques en stock : leur dépôt SE SOMME, converti dans l'unité de l'article (3 × 250 g + 2 × 500 g = 7 pièces de 250 g)", () => {
    const m = depotsMutualises(articles, new Map([["president", "3"], ["lurpak", "2"]]));
    expect(m.get("president")).toEqual({ depot: "7", negatif: false, inconvertibles: [] });
    expect(m.get("lurpak")).toEqual({ depot: "3.5", negatif: false, inconvertibles: [] });
    const m1 = m.get("president")!;
    const r = dispo({ president: { depot: m1.depot, restaurant: null, dernierMouvement: dm } });
    expect(r.etat).toBe("DISPONIBLE");
    expect(r.portions).toBe(7);
  });

  it("l'une des marques a un dépôt NÉGATIF : « À vérifier » (stock négatif) même si la somme est positive", () => {
    const m = depotsMutualises(articles, new Map([["president", "3"], ["lurpak", "-1"]]));
    expect(m.get("president")).toEqual({ depot: "1", negatif: true, inconvertibles: [] }); // 3 − 2 pièces : positif, mais…
    const r = dispo({ president: { depot: "1", restaurant: null, dernierMouvement: dm, depotNegatif: true } });
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "STOCK_NEGATIF", ingredient: "Beurre Président 250 g" }]);
    // Sans l'indicateur (ancien comportement), la somme masquait le négatif.
    expect(dispo({ president: { depot: "1", restaurant: null, dernierMouvement: dm } }).etat).toBe("DISPONIBLE");
  });

  it("une marque dont l'unité ne se ramène pas à celle de l'article : non additionnée, annoncée, « À vérifier »", () => {
    const LAIT: ArticleCatalogueLie = { id: "creme", unite: "L", designation: "Crème liquide" };
    const m = depotsMutualises([beurre(PRESIDENT, LAIT)], new Map([["president", "3"], ["creme", "5"]]));
    expect(m.get("president")).toEqual({ depot: "3", negatif: false, inconvertibles: ["Crème liquide"] });
    const r = dispo({ president: { depot: "3", restaurant: null, dernierMouvement: dm, depotInconvertibles: ["Crème liquide"] } });
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons.map((x) => x.motif)).toEqual(["UNITE_NON_CONVERTIBLE_ARTICLE_LIE"]);
  });

  it("un article rattaché seul garde son dépôt tel quel ; sans ligne de stock ni marque sœur : pas d'entrée", () => {
    expect(depotsMutualises([beurre(PRESIDENT)], new Map([["president", "3"]])).get("president")).toEqual({ depot: "3", negatif: false, inconvertibles: [] });
    expect(depotsMutualises([beurre(PRESIDENT)], new Map()).get("president")).toEqual({ depot: null, negatif: false, inconvertibles: [] });
  });
});

describe("Comparaison par article du catalogue : la consommation d'un article partagé n'est rangée sous aucune marque", () => {
  const e = entrees([beurre(PRESIDENT, LURPAK)], [], "1");
  it("« — » pour chaque marque (elle se lit par article du restaurant) ; un article à marque unique garde sa consommation", () => {
    const jours = ["2026-10-05", "2026-10-06"];
    const x: EntreesStockResto = { ...e, comptages: [{ articleRestoId: "beurre", date: "2026-10-05", quantite: "2" }, { articleRestoId: "beurre", date: "2026-10-06", quantite: "1" }] };
    const m = consommationParArticleCatalogue(x, jours);
    expect(m.get("president")).toEqual([null, null]);
    expect(m.get("lurpak")).toEqual([null, null]);
    expect(consoApproximativeParArticleCatalogue(x, jours).get("president")).toEqual([null, null]);
    const seul: EntreesStockResto = { ...x, articles: [beurre(PRESIDENT)] };
    expect(consommationParArticleCatalogue(seul, jours).get("president")![1]).toBe("4"); // 2 kg − 1 kg = 1 kg = 4 pièces de 250 g
  });
});
