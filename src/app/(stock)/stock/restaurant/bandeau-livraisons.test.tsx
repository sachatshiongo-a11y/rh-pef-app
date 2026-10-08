// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { stockRestaurantTheorique, type ArticleRestoSR, type EntreesStockResto, type LivraisonSR } from "@/lib/stock-restaurant";
import type { DecisionAuto } from "@/lib/fiches/rattachement-resto";

// Grille du restaurant : les livraisons de la semaine qui n'alimentent pas le stock du restaurant sont
// listées en trois groupes — rattachables automatiquement (bouton en lot, annonce de ce qui sera fait),
// à choisir (raison de la règle), à corriger à la main (unités, à répartir : même conseil que Mouvements).

const rattacher = vi.hoisted(() => vi.fn(async (_ids: string[]) => ({
  rattaches: [{ designationResto: "Sel", designationCatalogue: "Sel fin", espace: "CUISINE" as const }],
  crees: [{ designation: "Farfalle", espace: "CUISINE" as const, unite: "Paquet", categorie: "Pâtes" }],
  laisses: [{ designationCatalogue: "Citron", raison: "2 articles du restaurant portent ce nom : choisissez" }],
})));
vi.mock("./actions", () => ({ rattacherLivraisonsAutomatiquement: rattacher }));
const { BandeauLivraisons } = await import("./bandeau-livraisons");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const R = (id: string, unite: string | null, articleStockId: string, espace: "CUISINE" | "BAR" = "CUISINE"): ArticleRestoSR => ({ id, designation: id, espace, unite, articleStockId });
const L = (id: string, articleStockId: string, uniteCatalogue: string | null): LivraisonSR => ({
  id, articleStockId, designation: `Cat ${articleStockId}`, uniteCatalogue, date: "2026-09-22", quantite: "2", categorieSortie: "LIVRAISON_RESTAURANT",
});

describe("bandeau des livraisons non prises en compte", () => {
  it("non rattaché, unité du restaurant non renseignée, unités incompatibles, à répartir : chacun son conseil et son lien", () => {
    const e: EntreesStockResto = {
      articles: [R("biere", null, "cat-biere", "BAR"), R("vin", "bouteille", "cat-vin", "BAR"), R("c1", "pièce", "cat-citron"), R("c2", "pièce", "cat-citron")],
      comptages: [],
      livraisons: [L("l1", "cat-sel", "kg"), L("l2", "cat-biere", "Bouteille"), L("l3", "cat-vin", "l"), L("l4", "cat-citron", "pièce")],
    };
    const r = stockRestaurantTheorique(e, "2026-09-22");
    const signales = [...r.parArticle.values()].flatMap((a) => a.signalements);
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(<BandeauLivraisons nonRattachees={r.nonRattachees} signalements={signales} articles={e.articles} />);
    const liens = [...div.querySelectorAll("a")].filter((a) => !a.getAttribute("href")!.startsWith("/stock/catalogue/")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(liens).toEqual([
      ["non rattaché : rattachez l'article", "#grille-restaurant"],
      ["unité du restaurant non renseignée : renseignez-la dans Stock restaurant", "/stock/restaurant?espace=BAR"],
      ["unités incompatibles : corrigez l'unité du restaurant ou le rattachement", "/stock/restaurant?espace=BAR"],
      ["à répartir : plusieurs articles du restaurant rattachés", "/stock/restaurant?espace=CUISINE"],
    ]);
    // Les unités et la répartition ne se corrigent jamais toutes seules : groupe à part.
    expect(div.textContent).toContain("À corriger à la main (3 livraisons)");
    expect(div.textContent).not.toContain("Rattacher automatiquement");
    // Une livraison à répartir concerne deux articles : elle n'est listée qu'une fois.
    expect(div.textContent!.split("Cat cat-citron").length - 1).toBe(1);
  });

  it("rien à signaler : aucun bandeau", () => {
    expect(renderToStaticMarkup(<BandeauLivraisons nonRattachees={[]} signalements={[]} articles={[]} />)).toBe("");
  });
});

describe("bandeau — rattachement automatique", () => {
  let conteneur: HTMLDivElement;
  let racine: Root;
  afterEach(() => { act(() => racine.unmount()); conteneur.remove(); rattacher.mockClear(); });

  const PLAN: DecisionAuto[] = [
    { action: "RATTACHER", articleStockId: "cat-sel", articleRestoId: "r-sel", designationResto: "Sel", espace: "CUISINE" },
    { action: "CREER", articleStockId: "cat-farfalle", designation: "Farfalle", unite: "Paquet", categorie: "Pâtes", espace: "CUISINE" },
    { action: "LAISSER", articleStockId: "cat-citron", motif: "PLUSIEURS_CANDIDATS", raison: "2 articles du restaurant portent ce nom (« Citron », Cuisine ; « Citron », Bar) : choisissez" },
  ];
  // Deux livraisons du même article (sel) : un seul article pour le bouton, deux lignes annoncées.
  const LIVRAISONS = [L("l1", "cat-sel", "kg"), L("l2", "cat-sel", "kg"), L("l3", "cat-farfalle", "Paquet"), L("l4", "cat-citron", "pièce")];
  const monter = (nonRattachees: LivraisonSR[], planAuto: DecisionAuto[]) => {
    act(() => racine.render(createElement(BandeauLivraisons, { nonRattachees, signalements: [], articles: [], planAuto })));
  };
  const ouvrir = () => { conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur); };
  const bouton = () => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Rattacher automatiquement"));

  it("annonce ce qui sera fait, ligne par ligne ; le bouton compte les ARTICLES ; les laissés gardent leur raison", () => {
    ouvrir();
    monter(LIVRAISONS, PLAN);
    const t = conteneur.textContent!;
    expect(bouton()!.textContent).toBe("✓Rattacher automatiquement (2)");
    expect(t).toContain("Rattachables automatiquement (2 articles)");
    expect(t.split("sera rattaché à « Sel » (Cuisine)").length - 1).toBe(2);
    expect(t).toContain("sera ajouté au stock du restaurant : « Farfalle » (Cuisine, Paquet, Pâtes)");
    expect(t).toContain("À choisir (1 livraison)");
    expect(t).toContain("2 articles du restaurant portent ce nom (« Citron », Cuisine ; « Citron », Bar) : choisissez");
  });

  it("le clic envoie les articles automatiques (sans doublon) ; le compte-rendu reste quand le bandeau se vide", async () => {
    ouvrir();
    monter(LIVRAISONS, PLAN);
    await act(async () => bouton()!.click());
    expect(rattacher).toHaveBeenCalledWith(["cat-sel", "cat-farfalle"]);
    // Rafraîchissement après l'action : plus rien de rattachable, le compte-rendu reste affiché.
    monter([], []);
    const cr = conteneur.querySelector('[role="status"]')!.textContent!;
    expect(cr).toContain("Rattachement automatique : 1 rattaché · 1 créé · 1 laissé");
    expect(cr).toContain("« Sel fin » → rattaché à « Sel » (Cuisine)");
    expect(cr).toContain("« Farfalle » ajouté au stock du restaurant (Cuisine, Paquet, Pâtes) — stock de base à renseigner");
    expect(cr).toContain("« Citron » laissé : 2 articles du restaurant portent ce nom : choisissez");
    expect(bouton()).toBeUndefined();
  });
});
