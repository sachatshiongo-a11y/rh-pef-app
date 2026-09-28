import { describe, it, expect } from "vitest";
import {
  conseilLivraison, consommationReelle, etatRattachementLivraison, recuDuDepot, stockRestaurantTheorique, stockRestaurantPourDisponibilite, ECART_NEGATIF, LIBELLE_CONSO_INCONNUE, MENTION_AUCUN_COMPTAGE,
  type ArticleRestoSR, type ComptageSR, type EntreesStockResto, type LivraisonSR,
} from "./stock-restaurant";
import { calculerDisponibilite, libelleRaison, type ArticleDispo, type FicheDispo } from "./fiches/disponibilite";

// Stock théorique du restaurant : dernier comptage + livraisons du dépôt reçues DEPUIS, converties
// dans l'unité du restaurant. Tout est dérivé : aucun comptage n'est jamais écrit.

const R = (id: string, unite: string | null, articleStockId: string | null, espace: "CUISINE" | "BAR" = "CUISINE"): ArticleRestoSR => ({
  id, designation: `Resto ${id}`, espace, unite, articleStockId,
});
const C = (articleRestoId: string, date: string, quantite: string): ComptageSR => ({ articleRestoId, date, quantite });
let n = 0;
const L = (articleStockId: string, uniteCatalogue: string | null, date: string, quantite: string, categorieSortie: string | null = "LIVRAISON_RESTAURANT"): LivraisonSR => ({
  id: `l${++n}`, articleStockId, designation: `Catalogue ${articleStockId}`, uniteCatalogue, date, quantite, categorieSortie,
});
const E = (articles: ArticleRestoSR[], comptages: ComptageSR[], livraisons: LivraisonSR[]): EntreesStockResto => ({ articles, comptages, livraisons });
const stockDe = (e: EntreesStockResto, id: string, jour: string) => stockRestaurantTheorique(e, jour).parArticle.get(id)!;

const farine = R("farine", "g", "cat-farine");

describe("stock théorique du restaurant", () => {
  it("comptage seul : le stock est le dernier comptage à la date demandée", () => {
    const e = E([farine], [C("farine", "2026-09-18", "900"), C("farine", "2026-09-20", "1500"), C("farine", "2026-09-25", "10")], []);
    const s = stockDe(e, "farine", "2026-09-22");
    expect(s.stock).toBe("1500");
    expect(s.dernierComptage).toEqual({ date: "2026-09-20", quantite: "1500" });
    expect(s.livraisonsDepuis).toEqual([]);
    expect(s.aucunComptage).toBe(false);
    expect(s.derniereDate).toBe("2026-09-20");
    expect(s.signalements).toEqual([]);
  });

  it("comptage suivi de livraisons : comptage + livraisons converties (kg → g), jusqu'au jour demandé inclus", () => {
    const e = E([farine], [C("farine", "2026-09-20", "1500")], [
      L("cat-farine", "kg", "2026-09-19", "5"), // avant le comptage : déjà dans le comptage
      L("cat-farine", "kg", "2026-09-21", "2"),
      L("cat-farine", "kg", "2026-09-22", "0.5"),
      L("cat-farine", "kg", "2026-09-23", "7"), // après le jour demandé
    ]);
    const s = stockDe(e, "farine", "2026-09-22");
    expect(s.stock).toBe("4000");
    expect(s.livraisonsDepuis.map((l) => [l.date, l.quantiteCatalogue, l.quantiteResto])).toEqual([["2026-09-21", "2", "2000"], ["2026-09-22", "0.5", "500"]]);
    expect(s.derniereDate).toBe("2026-09-22");
  });

  it("livraison le jour du comptage : le comptage fait foi (fait après les livraisons du jour)", () => {
    const e = E([farine], [C("farine", "2026-09-20", "1500")], [L("cat-farine", "kg", "2026-09-20", "3")]);
    const s = stockDe(e, "farine", "2026-09-20");
    expect(s.stock).toBe("1500");
    expect(s.livraisonsDepuis).toEqual([]);
    expect(stockDe(e, "farine", "2026-09-21").stock).toBe("1500");
  });

  it("aucune livraison ni comptage : stock inconnu (null, affiché « — »), jamais 0", () => {
    const s = stockDe(E([farine], [], []), "farine", "2026-09-22");
    expect(s.stock).toBeNull();
    expect(s.derniereDate).toBeNull();
  });

  it("aucun comptage : stock estimé à partir des seules livraisons, avec la mention", () => {
    const e = E([farine], [], [L("cat-farine", "kg", "2026-09-10", "1"), L("cat-farine", "kg", "2026-09-21", "2")]);
    const s = stockDe(e, "farine", "2026-09-22");
    expect(s.stock).toBe("3000");
    expect(s.aucunComptage).toBe(true);
    expect(s.derniereDate).toBe("2026-09-21");
    expect(MENTION_AUCUN_COMPTAGE).toBe("aucun comptage : stock estimé à partir des seules livraisons");
  });

  it("aucun comptage et livraisons chargées depuis une date : l'estimation ne compte que la période chargée", () => {
    const e = { ...E([farine], [], [L("cat-farine", "kg", "2026-09-21", "2")]), debutLivraisons: "2026-09-21" };
    expect(stockDe(e, "farine", "2026-09-22").stock).toBe("2000");
    // Un article compté, lui, garde toutes ses livraisons depuis le comptage, même avant la période.
    const f = { ...E([farine], [C("farine", "2026-09-15", "100")], [L("cat-farine", "kg", "2026-09-16", "1")]), debutLivraisons: "2026-09-21" };
    expect(stockDe(f, "farine", "2026-09-22").stock).toBe("1100");
    // Une livraison chargée par erreur avant la période n'entre pas dans une estimation sans comptage.
    const g = { ...E([farine], [], [L("cat-farine", "kg", "2026-09-10", "5"), L("cat-farine", "kg", "2026-09-21", "2")]), debutLivraisons: "2026-09-21" };
    expect(stockDe(g, "farine", "2026-09-22").stock).toBe("2000");
  });

  it("conversion d'emballage : 4 paquets « 500 GR » livrés = 2 kg au restaurant", () => {
    const pates = R("pates", "kg", "cat-pates");
    const e = E([pates], [C("pates", "2026-09-20", "1")], [L("cat-pates", "500 GR", "2026-09-21", "4")]);
    expect(stockDe(e, "pates", "2026-09-21").stock).toBe("3");
  });

  it("unité incompatible : la livraison n'est pas additionnée, elle est signalée", () => {
    const vin = R("vin", "bouteille", "cat-vin", "BAR");
    const e = E([vin], [C("vin", "2026-09-20", "6")], [L("cat-vin", "l", "2026-09-21", "3")]);
    const s = stockDe(e, "vin", "2026-09-22");
    expect(s.stock).toBe("6");
    expect(s.signalements.map((x) => [x.motif, x.date, x.quantite])).toEqual([["UNITE_INCOMPATIBLE", "2026-09-21", "3"]]);
    expect(etatRattachementLivraison("cat-vin", "l", [vin])).toEqual({ etat: "UNITE_INCOMPATIBLE", articleRestoId: "vin" });
  });

  it("deux articles du restaurant rattachés dans le MÊME espace : « à répartir », jamais réparti au hasard", () => {
    const c1 = R("citron-1", "pièce", "cat-citron", "CUISINE");
    const c2 = R("citron-2", "pièce", "cat-citron", "CUISINE");
    const e = E([c1, c2], [C("citron-1", "2026-09-20", "10"), C("citron-2", "2026-09-20", "4")], [{ ...L("cat-citron", "pièce", "2026-09-21", "12"), domaine: "NOURRITURE" }]);
    const r = stockRestaurantTheorique(e, "2026-09-22");
    expect(r.parArticle.get("citron-1")!.stock).toBe("10");
    expect(r.parArticle.get("citron-2")!.stock).toBe("4");
    for (const id of ["citron-1", "citron-2"]) {
      const sig = r.parArticle.get(id)!.signalements;
      expect(sig.map((x) => x.motif)).toEqual(["A_REPARTIR"]);
      expect(sig[0]!.candidats).toEqual(["Resto citron-1", "Resto citron-2"]);
    }
    expect(etatRattachementLivraison("cat-citron", "pièce", [c1, c2], "NOURRITURE")).toEqual({ etat: "A_REPARTIR", articleRestoIds: ["citron-1", "citron-2"] });
  });

  it("un article en Cuisine et un au Bar : l'espace se lit par espace (Cuisine = nourriture, Bar = boissons)", () => {
    const cuisine = R("citron-c", "pièce", "cat-citron", "CUISINE");
    const bar = R("citron-b", "pièce", "cat-citron", "BAR");
    expect(etatRattachementLivraison("cat-citron", "pièce", [cuisine, bar], "NOURRITURE")).toEqual({ etat: "OK", articleRestoId: "citron-c" });
    expect(etatRattachementLivraison("cat-citron", "pièce", [cuisine, bar], "BOISSON")).toEqual({ etat: "OK", articleRestoId: "citron-b" });
    // Domaine inconnu : rien n'est choisi.
    expect(etatRattachementLivraison("cat-citron", "pièce", [cuisine, bar])).toEqual({ etat: "A_REPARTIR", articleRestoIds: ["citron-c", "citron-b"] });
    const e = E([cuisine, bar], [C("citron-c", "2026-09-20", "10"), C("citron-b", "2026-09-20", "4")], [{ ...L("cat-citron", "pièce", "2026-09-21", "12"), domaine: "BOISSON" }]);
    const r = stockRestaurantTheorique(e, "2026-09-22");
    expect([r.parArticle.get("citron-c")!.stock, r.parArticle.get("citron-b")!.stock]).toEqual(["10", "16"]);
  });

  it("unités : non renseignée au restaurant, non renseignée au catalogue, incompatibles — trois cas distincts", () => {
    expect(etatRattachementLivraison("cat-vin", "l", [R("vin", null, "cat-vin", "BAR")])).toEqual({ etat: "UNITE_RESTO_MANQUANTE", articleRestoId: "vin" });
    expect(etatRattachementLivraison("cat-vin", "  ", [R("vin", "bouteille", "cat-vin", "BAR")])).toEqual({ etat: "UNITE_CATALOGUE_MANQUANTE", articleRestoId: "vin" });
    expect(etatRattachementLivraison("cat-vin", "l", [R("vin", "bouteille", "cat-vin", "BAR")])).toEqual({ etat: "UNITE_INCOMPATIBLE", articleRestoId: "vin" });
    const e = E([R("vin", "", "cat-vin", "BAR")], [], [L("cat-vin", "Bouteille", "2026-09-21", "3")]);
    expect(recuDuDepot(e, "vin", "2026-09-21").signalements.map((x) => x.motif)).toEqual(["UNITE_RESTO_MANQUANTE"]);
  });

  it("conseil à la saisie : un message et un lien par cas", () => {
    const arts = [R("vin", null, "cat-vin", "BAR"), R("c1", "pièce", "cat-citron", "CUISINE"), R("c2", "pièce", "cat-citron", "CUISINE"), R("sel", "g", "cat-sel", "CUISINE")];
    const c = (id: string, unite: string | null, domaine?: "NOURRITURE" | "BOISSON") => conseilLivraison(etatRattachementLivraison(id, unite, arts, domaine), id, arts);
    expect(c("cat-riz", "kg")).toEqual({ texte: "non rattaché : rattachez l'article", href: "/stock/restaurant" });
    expect(c("cat-vin", "l", "BOISSON")).toEqual({ texte: "unité du restaurant non renseignée : renseignez-la dans Stock restaurant", href: "/stock/restaurant?espace=BAR" });
    expect(c("cat-sel", "pièce")).toEqual({ texte: "unités incompatibles : corrigez l'unité du restaurant ou le rattachement", href: "/stock/restaurant?espace=CUISINE" });
    expect(c("cat-sel", "")).toEqual({ texte: "unité du catalogue non renseignée : renseignez-la sur la fiche de l'article", href: "/stock/catalogue/cat-sel" });
    expect(c("cat-citron", "pièce", "NOURRITURE")).toEqual({ texte: "à répartir : plusieurs articles du restaurant rattachés", href: "/stock/restaurant?espace=CUISINE" });
    expect(c("cat-sel", "g")).toBeNull();
  });

  it("une sortie Perte (ou sans motif) n'alimente jamais le restaurant", () => {
    const e = E([farine], [C("farine", "2026-09-20", "1500")], [
      L("cat-farine", "kg", "2026-09-21", "1", "PERTE"),
      L("cat-farine", "kg", "2026-09-21", "1", null),
    ]);
    const r = stockRestaurantTheorique(e, "2026-09-22");
    expect(r.parArticle.get("farine")!.stock).toBe("1500");
    expect(r.nonRattachees).toEqual([]);
  });

  it("article du catalogue non rattaché : la livraison est ignorée et listée « non rattaché »", () => {
    const sel = L("cat-sel", "kg", "2026-09-21", "1");
    const e = E([farine], [C("farine", "2026-09-20", "1500")], [sel]);
    const r = stockRestaurantTheorique(e, "2026-09-22");
    expect(r.parArticle.get("farine")!.stock).toBe("1500");
    expect(r.nonRattachees).toEqual([sel]);
    expect(stockRestaurantTheorique(e, "2026-09-20").nonRattachees).toEqual([]);
    expect(etatRattachementLivraison("cat-sel", "kg", [farine])).toEqual({ etat: "NON_RATTACHE" });
  });
});

describe("reçu du dépôt, jour par jour", () => {
  it("additionne les livraisons du jour, converties ; « — » (null) quand rien n'est reçu", () => {
    const e = E([farine], [], [L("cat-farine", "kg", "2026-09-21", "2"), L("cat-farine", "kg", "2026-09-21", "0.25"), L("cat-farine", "kg", "2026-09-22", "1", "PERTE")]);
    expect(recuDuDepot(e, "farine", "2026-09-21")).toEqual({ quantite: "2250", signalements: [] });
    expect(recuDuDepot(e, "farine", "2026-09-22")).toEqual({ quantite: null, signalements: [] });
  });

  it("une livraison incompatible du jour est signalée, pas additionnée", () => {
    const vin = R("vin", "bouteille", "cat-vin", "BAR");
    const r = recuDuDepot(E([vin], [], [L("cat-vin", "l", "2026-09-21", "3")]), "vin", "2026-09-21");
    expect(r.quantite).toBeNull();
    expect(r.signalements.map((s) => s.motif)).toEqual(["UNITE_INCOMPATIBLE"]);
  });
});

describe("consommation réelle", () => {
  const e = E([farine], [C("farine", "2026-09-20", "1500"), C("farine", "2026-09-21", "2800"), C("farine", "2026-09-23", "900")], [
    L("cat-farine", "kg", "2026-09-21", "2"),
    L("cat-farine", "kg", "2026-09-22", "1"),
    L("cat-farine", "kg", "2026-09-23", "0.5"),
  ]);

  it("cas nominal : stock compté la veille + livré le jour − compté le jour", () => {
    // 1500 (compté le 20) + 2000 (livré le 21) − 2800 (compté le 21) = 700.
    expect(consommationReelle(e, "farine", "2026-09-21")).toEqual({ etat: "CONNUE", quantite: "700", negative: false, stockVeille: "1500", recu: "2000", compte: "2800", veilleEstimee: false });
  });

  it("veille sans comptage : stock théorique de la veille (dernier comptage + livraisons depuis)", () => {
    // Veille (22) : 2800 + 1000 = 3800 ; + 500 livré le 23 − 900 compté = 3400.
    const r = consommationReelle(e, "farine", "2026-09-23");
    expect(r).toMatchObject({ etat: "CONNUE", quantite: "3400", stockVeille: "3800", recu: "500", compte: "900" });
  });

  it("jour sans comptage : « — », jamais 0", () => {
    expect(consommationReelle(e, "farine", "2026-09-22")).toEqual({ etat: "INCONNUE", raison: "PAS_DE_COMPTAGE" });
    expect(LIBELLE_CONSO_INCONNUE.PAS_DE_COMPTAGE).toBeTruthy();
  });

  it("premier comptage sans rien avant : stock de la veille inconnu", () => {
    expect(consommationReelle(e, "farine", "2026-09-20")).toEqual({ etat: "INCONNUE", raison: "STOCK_VEILLE_INCONNU" });
  });

  it("consommation négative : signalée (« écart : plus compté que reçu »), jamais masquée", () => {
    const x = E([farine], [C("farine", "2026-09-20", "1000"), C("farine", "2026-09-21", "1800")], [L("cat-farine", "kg", "2026-09-21", "0.5")]);
    expect(consommationReelle(x, "farine", "2026-09-21")).toMatchObject({ etat: "CONNUE", quantite: "-300", negative: true });
    expect(ECART_NEGATIF).toBe("écart : plus compté que reçu");
  });

  it("livraison du jour non additionnable (unité incompatible) : consommation inconnue", () => {
    const vin = R("vin", "bouteille", "cat-vin", "BAR");
    const x = E([vin], [C("vin", "2026-09-20", "6"), C("vin", "2026-09-21", "4")], [L("cat-vin", "l", "2026-09-21", "3")]);
    expect(consommationReelle(x, "vin", "2026-09-21")).toEqual({ etat: "INCONNUE", raison: "LIVRAISON_NON_COMPTEE" });
  });

  it("veille estimée sans aucun comptage : calculée, mais annoncée comme estimée", () => {
    const x = E([farine], [C("farine", "2026-09-21", "500")], [L("cat-farine", "kg", "2026-09-20", "1")]);
    expect(consommationReelle(x, "farine", "2026-09-21")).toMatchObject({ etat: "CONNUE", quantite: "500", veilleEstimee: true });
  });
});

describe("part du restaurant dans la disponibilité des plats", () => {
  const Rc = (id: string, unite: string, uniteCatalogue: string, articleStockId = "farine"): ArticleRestoSR => ({ ...R(id, unite, articleStockId), uniteCatalogue });
  const FARINE: ArticleDispo = { id: "farine", designation: "Farine", unite: "kg" };
  const plat: FicheDispo = {
    id: "p", nom: "Pâte", nbPortions: 1, estSousRecette: false, rendementQuantite: null, rendementUnite: null,
    ingredients: [{ nom: "Farine", unite: "g", quantite: "100", articleId: "farine", sousFicheId: null }],
  };
  const ctx = (depot: string, e: EntreesStockResto, jour: string) => ({
    fiches: new Map([[plat.id, plat]]),
    articles: new Map([[FARINE.id, FARINE]]),
    stocks: new Map([["farine", { depot, restaurant: stockRestaurantPourDisponibilite(e, jour).get("farine") ?? null, dernierMouvement: jour }]]),
  });

  it("convertit le dernier comptage dans l'unité du catalogue et additionne plusieurs articles rattachés", () => {
    const e = E([Rc("f1", "g", "kg"), Rc("f2", "kg", "kg")], [C("f1", "2026-09-22", "1500"), C("f2", "2026-09-20", "2")], []);
    expect(stockRestaurantPourDisponibilite(e, "2026-09-22").get("farine")).toEqual({ etat: "OK", quantite: "3.5", dateComptage: "2026-09-20", recu: null });
  });

  it("unité non convertible : l'article est marqué, rien n'est additionné", () => {
    const e = E([Rc("c1", "pièce", "l", "creme"), Rc("c2", "l", "l", "creme")], [C("c1", "2026-09-22", "3"), C("c2", "2026-09-22", "1")], []);
    expect(stockRestaurantPourDisponibilite(e, "2026-09-22").get("creme")).toEqual({ etat: "UNITE_NON_CONVERTIBLE", articleResto: "Resto c1" });
  });

  it("pas de double compte : dépôt + restaurant identiques avant et après une livraison", () => {
    const f = Rc("f1", "g", "kg");
    const avant = E([f], [C("f1", "2026-09-20", "2000")], []);
    const apres = E([f], [C("f1", "2026-09-20", "2000")], [L("farine", "kg", "2026-09-21", "3")]);
    // Avant : dépôt 10 kg + restaurant 2 kg. La livraison de 3 kg retire 3 kg du dépôt (7 kg).
    const r1 = calculerDisponibilite(plat, ctx("10", avant, "2026-09-21"), "2026-09-21").articles[0]!;
    const r2 = calculerDisponibilite(plat, ctx("7", apres, "2026-09-21"), "2026-09-21").articles[0]!;
    expect([r1.depot, r1.restaurant, r1.disponible]).toEqual(["10", "2", "12"]);
    expect([r2.depot, r2.restaurant, r2.disponible]).toEqual(["7", "5", "12"]);
    expect(r2.recuRestaurant).toBe("3");
    expect(r2.portions).toBe(r1.portions);
  });

  it("règle des 7 jours : seule la date du dernier COMPTAGE compte — une livraison ne rafraîchit jamais le stock", () => {
    const f = Rc("f1", "g", "kg");
    const sansLivraison = E([f], [C("f1", "2026-09-10", "2000")], []);
    const avecLivraison = E([f], [C("f1", "2026-09-10", "2000")], [L("farine", "kg", "2026-09-20", "1"), L("farine", "kg", "2026-09-21", "1")]);
    expect(calculerDisponibilite(plat, ctx("1", sansLivraison, "2026-09-22"), "2026-09-22").raisons).toEqual([{ motif: "COMPTAGE_RESTAURANT_ANCIEN", ingredient: "Farine", depuis: "2026-09-10" }]);
    const r = calculerDisponibilite(plat, ctx("1", avecLivraison, "2026-09-22"), "2026-09-22");
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "COMPTAGE_RESTAURANT_ANCIEN", ingredient: "Farine", depuis: "2026-09-10" }]);
    expect(libelleRaison(r.raisons[0]!)).toBe("Farine : comptage du restaurant ancien, dernier comptage le 10/09");
    expect(stockRestaurantPourDisponibilite(avecLivraison, "2026-09-22").get("farine")).toEqual({ etat: "OK", quantite: "4", dateComptage: "2026-09-10", recu: "2" });
  });

  it("livraison à répartir : le plat passe « À vérifier », jamais réparti au hasard", () => {
    const e = E([Rc("f1", "g", "kg"), Rc("f2", "kg", "kg")], [C("f1", "2026-09-20", "1000"), C("f2", "2026-09-20", "1")], [L("farine", "kg", "2026-09-21", "3")]);
    expect(stockRestaurantPourDisponibilite(e, "2026-09-21").get("farine")).toEqual({ etat: "A_REPARTIR", articleResto: "Resto f1" });
    const r = calculerDisponibilite(plat, ctx("1", e, "2026-09-21"), "2026-09-21");
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.raisons).toEqual([{ motif: "LIVRAISON_RESTAURANT_A_REPARTIR", ingredient: "Farine" }]);
  });

  it("aucun comptage : stock du restaurant ESTIMÉ, hors des portions — l'ingrédient est « À vérifier », le dépôt seul compte", () => {
    const e = E([Rc("f1", "g", "kg")], [], [L("farine", "kg", "2026-09-21", "3")]);
    expect(stockRestaurantPourDisponibilite(e, "2026-09-21").get("farine")).toEqual({ etat: "ESTIME", quantite: "3", recu: "3" });
    const r = calculerDisponibilite(plat, ctx("1", e, "2026-09-21"), "2026-09-21");
    expect(r.etat).toBe("A_VERIFIER");
    expect(r.portions).toBeNull();
    expect(r.raisons).toEqual([{ motif: "STOCK_RESTAURANT_ESTIME", ingredient: "Farine" }]);
    expect(libelleRaison(r.raisons[0]!)).toBe("Farine : stock du restaurant estimé : aucun comptage");
    const a = r.articles[0]!;
    expect([a.depot, a.restaurant, a.restaurantEstime, a.disponible]).toEqual(["1", "3", true, "1"]);
  });

  it("un article rattaché sans comptage ni livraison n'apporte rien (ni estimé, ni zéro)", () => {
    const e = E([Rc("f1", "g", "kg"), Rc("f2", "kg", "kg")], [C("f1", "2026-09-20", "1000")], []);
    expect(stockRestaurantPourDisponibilite(e, "2026-09-21").get("farine")).toEqual({ etat: "OK", quantite: "1", dateComptage: "2026-09-20", recu: null });
  });
});
