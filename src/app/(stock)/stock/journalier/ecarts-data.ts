import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerEntreesStockResto } from "@/lib/stock-restaurant-charger";
import { ecartsVentesConsommation, type EcartsVentes, type PrixCatalogue } from "@/lib/ecarts-ventes";
import { prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import type { Domaine } from "./donnees-restaurant";

// Données du contrôle « Écarts ventes / consommation » (Conso. journalière), partagées par l'écran et ses
// exports : requêtes GROUPÉES pour la semaine (comptages, livraisons, ventes, fiches, prix), lecture seule.

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function chargerEcartsVentes(lundi: Date, domaine: Domaine): Promise<{ debut: string; fin: string; espaces: ("CUISINE" | "BAR")[]; ecarts: EcartsVentes }> {
  const dimanche = new Date(lundi); dimanche.setUTCDate(dimanche.getUTCDate() + 6);
  return chargerEcartsVentesPeriode(iso(lundi), iso(dimanche), domaine);
}

/**
 * Le même contrôle sur une PÉRIODE quelconque `[debut, fin]` (dates pures AAAA-MM-JJ, bornes incluses) : la semaine de
 * l'écran (ci-dessus) ou, depuis le 2026-10-12, le mois écoulé du rapport mensuel du Stock. Même chargement, même calcul
 * (`ecartsVentesConsommation`) — seule la fenêtre change. Lecture seule.
 */
export async function chargerEcartsVentesPeriode(debut: string, fin: string, domaine?: Domaine): Promise<{ debut: string; fin: string; espaces: ("CUISINE" | "BAR")[]; ecarts: EcartsVentes }> {
  const espace = domaine === "NOURRITURE" ? ("CUISINE" as const) : domaine === "BOISSON" ? ("BAR" as const) : undefined;
  const entrees = await chargerEntreesStockResto({ depuis: debut, jusquA: fin, inclureDesactives: true, avecVentes: "periode" });
  const ids = [...new Set(entrees.articles.flatMap((a) => a.rattaches.map((r) => r.id)))];
  const [articles, taux] = await Promise.all([
    ids.length === 0 ? [] : prisma.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } }),
    tauxDuJour(),
  ]);
  const prix = new Map<string, PrixCatalogue>();
  for (const a of articles) { const p = prixSaisi(a); if (p) prix.set(a.id, p); }
  return {
    debut, fin, espaces: espace ? [espace] : ["CUISINE", "BAR"],
    ecarts: ecartsVentesConsommation(entrees, debut, fin, prix, { espace, tauxCDFParUSD: taux }),
  };
}
