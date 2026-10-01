import "server-only";

// CŒUR DES ENTRÉES / SORTIES MANUELLES — un seul chemin d'écriture pour le geste direct (Direction, ou
// flux libre) ET pour la validation d'une demande. Hors fichier « use server » (voir reglement.ts).
//
// Décision de la Direction (2026-10-01) :
//  - SORTIE « Livraison restaurant » ou « Perte » : libre pour tout compte Stock (flux du restaurant) ;
//  - toute AUTRE sortie manuelle (sans motif : inventaire, correction, consommation…) : hors Direction,
//    une demande à valider ;
//  - ENTRÉE manuelle, « Retour restaurant » COMPRIS (décision de Sacha, 2026-10-01 : « Retours à
//    valider ») : hors Direction, une demande à valider. Les vrais achats (Liste d'achat, entrée en
//    stock d'une facture), rattachés à un fournisseur et à un montant, restent libres.

import type { Prisma } from "@prisma/client";
import { verrouillerStocks } from "./comptage";
import { dec } from "@/lib/nombre";
import { notifierNouvellesAlertes } from "@/lib/alerte-stock";
import type { NiveauAlerte } from "@/lib/stock";

type Tx = Prisma.TransactionClient;

export type MotifSortie = "PERTE" | "LIVRAISON_RESTAURANT" | null;
export type MouvementSaisi = {
  type: "ENTREE" | "SORTIE";
  date: Date;
  categorieSortie: MotifSortie;
  raisonSortie: string | null;
  origine: string;
  /** Entrée déclarée « Retour restaurant » (libellé seulement : à valider hors Direction, comme toute entrée manuelle). */
  retourRestaurant: boolean;
  lignes: { articleId: string; quantite: number }[];
};

export const ORIGINE_RETOUR_RESTAURANT = "Retour restaurant";

/** Lit le formulaire « Mouvement manuel » — MÊMES RÈGLES qu'avant (motifs, raison de perte, libellés). */
export function lireMouvementSaisi(formData: FormData): MouvementSaisi {
  const type = String(formData.get("type") ?? "SORTIE") === "ENTREE" ? "ENTREE" : "SORTIE";
  const ids = formData.getAll("articleId").map(String);
  const qtes = formData.getAll("quantite").map(dec);
  const dateStr = String(formData.get("date") ?? "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Date du mouvement invalide.");

  let categorieSortie: MotifSortie = null;
  let raisonSortie: string | null = null;
  let retourRestaurant = false;
  let origine = String(formData.get("origine") ?? "").trim();
  if (type === "SORTIE") {
    const cat = String(formData.get("categorieSortie") ?? "").trim();
    categorieSortie = cat === "PERTE" || cat === "LIVRAISON_RESTAURANT" ? cat : null;
    raisonSortie = String(formData.get("raisonSortie") ?? "").trim() || null;
    if (categorieSortie === "PERTE" && !raisonSortie) throw new Error("Indiquez la raison de la perte.");
    origine = origine || (categorieSortie === "PERTE" ? `Perte${raisonSortie ? ` — ${raisonSortie}` : ""}` : categorieSortie === "LIVRAISON_RESTAURANT" ? "Livraison restaurant" : "Sortie / consommation");
  } else {
    retourRestaurant = String(formData.get("motifEntree") ?? "") === "RETOUR_RESTAURANT";
    origine = origine || (retourRestaurant ? ORIGINE_RETOUR_RESTAURANT : "Entrée manuelle");
  }

  const lignes = ids
    .map((articleId, i) => ({ articleId, quantite: qtes[i] ?? 0 }))
    .filter((l) => l.articleId && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article + quantité).");
  // Bornes de la colonne (Decimal(14,3)) : refus lisible à la saisie plutôt qu'une erreur de la base.
  for (const l of lignes) {
    if (l.quantite >= 1e11) throw new Error(`Quantité hors limites (${l.quantite}) : vérifiez la saisie.`);
    if (Math.round(l.quantite * 1000) / 1000 !== l.quantite) throw new Error(`Quantité ${String(l.quantite).replace(".", ",")} : 3 décimales au plus.`);
  }
  return { type, date, categorieSortie, raisonSortie, origine, retourRestaurant, lignes };
}

/** Flux libre (aucune validation, quel que soit le compte) : SORTIE « Livraison restaurant » ou « Perte » seulement. */
export const estMouvementLibre = (m: Pick<MouvementSaisi, "type" | "categorieSortie">) =>
  m.type === "SORTIE" && m.categorieSortie !== null;

/** Écrit les mouvements et met le stock à jour (ENTRÉE incrémente, SORTIE décrémente). */
export async function ecrireMouvementsTx(tx: Tx, userId: string, m: MouvementSaisi) {
  // Lignes de stock verrouillées d'abord, dans un ordre fixe : pas d'interblocage avec un comptage.
  await verrouillerStocks(tx, [...new Set(m.lignes.map((l) => l.articleId))]);
  for (const l of m.lignes) {
    await tx.mouvementStock.create({ data: { articleId: l.articleId, type: m.type, quantite: l.quantite, origine: m.origine, date: m.date, categorieSortie: m.categorieSortie, raisonSortie: m.raisonSortie, creeParId: userId } });
    await tx.stock.upsert({
      where: { articleId: l.articleId },
      update: { quantite: m.type === "ENTREE" ? { increment: l.quantite } : { decrement: l.quantite } },
      create: { articleId: l.articleId, quantite: m.type === "ENTREE" ? l.quantite : -l.quantite },
    });
  }
}

/** Après l'écriture (hors transaction) : articles passés sous leur seuil après une sortie. */
export async function apresMouvements(m: Pick<MouvementSaisi, "type" | "lignes">, niveauxAvant: Map<string, NiveauAlerte>) {
  if (m.type === "SORTIE") await notifierNouvellesAlertes(m.lignes.map((l) => l.articleId), niveauxAvant);
}
