// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BandeauLivraisons } from "./bandeau-livraisons";
import { stockRestaurantTheorique, type ArticleRestoSR, type EntreesStockResto, type LivraisonSR } from "@/lib/stock-restaurant";

// Grille du restaurant : les livraisons de la semaine qui n'alimentent pas le stock du restaurant sont
// listées avec le MÊME conseil que dans Mouvements — un message et un lien par cas.

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
    // Une livraison à répartir concerne deux articles : elle n'est listée qu'une fois.
    expect(div.textContent!.split("Cat cat-citron").length - 1).toBe(1);
  });

  it("rien à signaler : aucun bandeau", () => {
    expect(renderToStaticMarkup(<BandeauLivraisons nonRattachees={[]} signalements={[]} articles={[]} />)).toBe("");
  });
});
