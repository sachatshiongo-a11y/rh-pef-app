import "server-only";

import type { ArticleStock, Stock } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { niveauAlerte } from "@/lib/stock";
import { articlesEnHausse } from "@/lib/stock-prix";
import { articleDansFiltre, type ArticleFiltrable, type FiltreInventaire } from "@/lib/filtre-inventaire";

// Ce que l'écran Inventaire et ses exports (Excel, PDF, page imprimable) calculent EN COMMUN : les hausses de
// prix d'achat (factures datées + entrées payées hors facture) et l'appartenance au filtre. Avant le 2026-10-08,
// chaque export relisait le domaine entier, ignorait le filtre de l'écran et comptait ses hausses autrement.

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";

/** % de hausse du dernier prix d'achat par article (les mêmes que le badge 📈 de l'écran). */
export async function chargerHausses(domaine?: Domaine): Promise<Map<string, number>> {
  const [lignes, entreesPayees] = await Promise.all([
    prisma.ligneFacture.findMany({
      where: { article: domaine ? { domaine } : {}, facture: { date: { not: null } } },
      select: { articleId: true, prixUnitaireUSD: true, quantite: true, facture: { select: { id: true, numero: true, date: true } } },
    }),
    // Entrées PAYÉES hors facture (liste d'achat, mouvement manuel avec montant) : des achats quand même.
    prisma.mouvementStock.findMany({
      where: { type: "ENTREE", factureId: null, montantUSD: { not: null }, ...(domaine ? { article: { domaine } } : {}) },
      select: { articleId: true, montantUSD: true, quantite: true, date: true, origine: true },
    }),
  ]);
  return articlesEnHausse(lignes, entreesPayees);
}

/** L'article tel que le filtre l'a toujours lu à l'écran (mêmes champs, mêmes valeurs par défaut). */
export function versArticleFiltrable(a: ArticleStock & { stock: Stock | null }, hausses: Map<string, number>): ArticleFiltrable {
  return {
    designation: a.designation,
    code: a.code,
    niveau: a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null,
    haussePct: hausses.get(a.id) ?? null,
    devisePrix: a.devisePrix,
    prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
    prixCDF: a.prixUnitaireCDF !== null ? a.prixUnitaireCDF.toString() : null,
    fournisseurId: a.fournisseurId,
    stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0",
    unite: a.unite,
    quantite: a.stock ? a.stock.quantite.toString() : "0",
  };
}

/** Les articles de l'ensemble filtré affiché (tous, pas une page), dans l'ordre reçu. */
export function filtrerArticles<T extends ArticleStock & { stock: Stock | null }>(articles: T[], hausses: Map<string, number>, filtre: FiltreInventaire): T[] {
  return articles.filter((a) => articleDansFiltre(versArticleFiltrable(a, hausses), filtre));
}
