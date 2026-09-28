import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargerEntreesStockResto } from "@/lib/stock-restaurant-charger";
import { consommationsSemaine, sortiesParMotif } from "@/lib/journalier-restaurant";
import type { EntreesStockResto } from "@/lib/stock-restaurant";

// Données « restaurant » de la Conso. journalière, partagées par l'écran et ses exports PDF / Excel :
// sorties du dépôt de la semaine (séparées par motif) et entrées du stock théorique du restaurant
// (comptages, livraisons, rattachements). Requêtes GROUPÉES pour toute la semaine, lecture seule.

export type Domaine = "NOURRITURE" | "BOISSON" | undefined;

/** Espace du restaurant qui correspond au filtre de l'écran (« Cuisine (nourriture) », « Bar (boissons) »). */
export const espaceDuDomaine = (d: Domaine) => (d === "NOURRITURE" ? "CUISINE" : d === "BOISSON" ? "BAR" : undefined);

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function chargerDonneesRestaurant(lundi: Date, domaine: Domaine) {
  const jours = Array.from({ length: 7 }, (_, i) => { const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
  const fin = new Date(lundi); fin.setUTCDate(fin.getUTCDate() + 7);
  const where: Prisma.MouvementStockWhereInput = { type: "SORTIE", date: { gte: lundi, lt: fin }, ...(domaine ? { article: { domaine } } : {}) };
  const [sorties, entrees] = await Promise.all([
    prisma.mouvementStock.findMany({ where, select: { articleId: true, date: true, quantite: true, categorieSortie: true, article: { select: { designation: true } } } }),
    chargerEntreesStockResto({ depuis: jours[0]!, jusquA: jours[6]! }),
  ]);
  return {
    jours,
    entrees: entrees as EntreesStockResto,
    sorties: sortiesParMotif(
      sorties.map((m) => ({ articleId: m.articleId, designation: m.article.designation, date: iso(m.date), quantite: Number(m.quantite), categorieSortie: m.categorieSortie })),
      jours,
    ),
    consoResto: consommationsSemaine(entrees, jours, espaceDuDomaine(domaine)),
  };
}
