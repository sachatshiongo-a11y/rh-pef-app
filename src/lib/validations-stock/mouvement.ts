import "server-only";

// CŒUR DES ENTRÉES / SORTIES MANUELLES — un seul chemin d'écriture pour le geste direct (tout compte
// Stock) ET pour la validation d'une ANCIENNE demande. Hors fichier « use server » (voir reglement.ts).
//
// Décision de Sacha (2026-10-07), qui remplace celle du 2026-10-01 : « je ne veux pas que la direction
// ait à valider les sorties de stock, je veux juste recevoir les notifications ». Toute entrée ou
// sortie manuelle, quel que soit le motif (inventaire, correction, retour restaurant, livraison,
// perte…), est ÉCRITE tout de suite, pour tout compte Stock, avec les mêmes contrôles qu'avant
// (période ouverte, article existant, quantité bornée, jour civil de Kinshasa par défaut). Un compte
// non-Direction déclenche une notification à la Direction (geste-notifie.ts). Plus aucune demande
// MOUVEMENT_MANUEL n'est créée ; celles déjà en attente restent décidables (demandes.ts).

import type { Prisma } from "@prisma/client";
import { verrouillerStocks } from "./comptage";
import { decSaisi } from "@/lib/nombre";
import { niveauxActuels, notifierNouvellesAlertes } from "@/lib/alerte-stock";
import type { NiveauAlerte } from "@/lib/stock";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { prisma } from "@/lib/prisma";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { notifierGesteStock, type AuteurGeste } from "./geste-notifie";
import { MESSAGE_RAISON_PERTE, exigerMotifSortie, origineDuMotif } from "@/lib/motif-sortie";

type Tx = Prisma.TransactionClient;

export type MotifSortie = "PERTE" | "LIVRAISON_RESTAURANT" | null;
export type MouvementSaisi = {
  type: "ENTREE" | "SORTIE";
  date: Date;
  categorieSortie: MotifSortie;
  raisonSortie: string | null;
  origine: string;
  /** Entrée déclarée « Retour restaurant » (libellé seulement : écrite et notifiée comme toute entrée manuelle). */
  retourRestaurant: boolean;
  lignes: { articleId: string; quantite: number }[];
};

export const ORIGINE_RETOUR_RESTAURANT = "Retour restaurant";

/** Lit le formulaire « Mouvement manuel » — MÊMES RÈGLES qu'avant (motifs, raison de perte, libellés). */
export function lireMouvementSaisi(formData: FormData): MouvementSaisi {
  const type = String(formData.get("type") ?? "SORTIE") === "ENTREE" ? "ENTREE" : "SORTIE";
  const ids = formData.getAll("articleId").map(String);
  const qtes = formData.getAll("quantite").map((v, i) => decSaisi(v, `quantité, ligne ${i + 1}`)); // illisible : refus lisible, jamais un zéro
  const dateStr = String(formData.get("date") ?? "").trim();
  const date = dateStr ? new Date(dateStr) : jourCivilKinshasa(new Date()); // jour civil de Kinshasa
  if (Number.isNaN(date.getTime())) throw new Error("Date du mouvement invalide.");

  let categorieSortie: MotifSortie = null;
  let raisonSortie: string | null = null;
  let retourRestaurant = false;
  let origine = String(formData.get("origine") ?? "").trim();
  if (type === "SORTIE") {
    // Motif OBLIGATOIRE pour toute sortie, quel que soit le compte (décision du 2026-10-07).
    const motif = exigerMotifSortie("SORTIE", String(formData.get("categorieSortie") ?? "").trim());
    categorieSortie = motif;
    raisonSortie = String(formData.get("raisonSortie") ?? "").trim() || null;
    if (motif === "PERTE" && !raisonSortie) throw new Error(MESSAGE_RAISON_PERTE);
    origine = origine || origineDuMotif(motif!, raisonSortie);
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

/** Écrit les mouvements et met le stock à jour (ENTRÉE incrémente, SORTIE décrémente). */
export async function ecrireMouvementsTx(tx: Tx, userId: string, m: MouvementSaisi) {
  // Défense en profondeur : aucune SORTIE sans motif, d'où qu'elle vienne (geste direct ou demande).
  exigerMotifSortie(m.type, m.categorieSortie);
  if (m.categorieSortie === "PERTE" && !m.raisonSortie?.trim()) throw new Error(MESSAGE_RAISON_PERTE);
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

/**
 * Geste direct d'une entrée/sortie manuelle, pour TOUT compte Stock (décision du 2026-10-07) : contrôles,
 * écriture en une transaction, puis — APRÈS, jamais bloquant — alertes de seuil et notification de la
 * Direction (rien si l'auteur est la Direction).
 */
export async function appliquerMouvementManuel(user: AuteurGeste, m: MouvementSaisi): Promise<void> {
  await exigerPeriodeOuverte(m.date);
  const ids = m.lignes.map((l) => l.articleId);
  // Articles vérifiés DÈS LA SAISIE : un id forgé ne crée pas une ligne de stock.
  const arts = await prisma.articleStock.findMany({ where: { id: { in: ids } }, select: { id: true, designation: true, unite: true } });
  const parId = new Map(arts.map((a) => [a.id, a]));
  if (ids.some((id) => !parId.has(id))) throw new Error("Article introuvable : rechargez la page.");
  // Niveaux d'alerte AVANT la sortie, pour ne notifier que les articles qui viennent de passer bas.
  const niveauxAvant = m.type === "SORTIE" ? await niveauxActuels(ids) : new Map<string, NiveauAlerte>();
  await prisma.$transaction((tx) => ecrireMouvementsTx(tx, user.id, m));
  try { await apresMouvements(m, niveauxAvant); } catch (e) { console.error("[stock] alertes après mouvement en échec :", e); }
  await notifierGesteStock(user, {
    genre: "MOUVEMENT", type: m.type, categorieSortie: m.categorieSortie, origine: m.origine, date: m.date,
    lignes: m.lignes.map((l) => ({ articleId: l.articleId, designation: parId.get(l.articleId)!.designation, unite: parId.get(l.articleId)!.unite, quantite: l.quantite })),
  });
}
