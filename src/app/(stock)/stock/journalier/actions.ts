"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";

// Saisie case par case de la grille « Commande » (≈ 178 articles × 7 jours).
//
// PAS de `revalidatePath` ici : mesuré le 2026-09-24, chaque case validée renvoyait toute la page
// (3 requêtes Prisma côté serveur, puis les 178 lignes — 1 246 champs — re-rendues côté client),
// et les actions serveur passant l'une après l'autre, une saisie rapide empilait ces rechargements.
// La grille garde elle-même les valeurs saisies ; elle appelle `rafraichirJournalier` une fois la
// saisie au repos (et en quittant l'onglet), pour que les autres vues et l'historique du
// navigateur ne montrent pas une commande périmée.

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

function lireCase(dateIso: string, quantite: number) {
  if (!DATE_ISO.test(dateIso)) throw new Error("Date de commande invalide.");
  const q = Number(quantite);
  if (!Number.isFinite(q) || q < 0) throw new Error("Quantité invalide.");
  return { date: new Date(dateIso + "T00:00:00Z"), q };
}

/** Enregistre la quantité commandée d'un article pour un jour (0/vide = supprime la ligne). */
export const saisirCommandeResto = actionLisible(async (articleId: string, dateIso: string, quantite: number) => {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!articleId) throw new Error("Article manquant.");
  const { date, q } = lireCase(dateIso, quantite);
  if (q === 0) {
    await prisma.commandeResto.deleteMany({ where: { articleId, date } });
  } else {
    await prisma.commandeResto.upsert({
      where: { articleId_date: { articleId, date } },
      update: { quantite: q },
      create: { articleId, date, quantite: q },
    });
  }
  return { ok: true as const };
});

/** Idem pour un légume frais (liste figée, hors catalogue). */
export const saisirCommandeLegume = actionLisible(async (legume: string, dateIso: string, quantite: number) => {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!legume) throw new Error("Légume manquant.");
  const { date, q } = lireCase(dateIso, quantite);
  if (q === 0) {
    await prisma.commandeLegumeResto.deleteMany({ where: { legume, date } });
  } else {
    await prisma.commandeLegumeResto.upsert({
      where: { legume_date: { legume, date } },
      update: { quantite: q },
      create: { legume, date, quantite: q },
    });
  }
  return { ok: true as const };
});

/** Une seule revalidation après une rafale de saisies (au lieu d'une par case). */
export async function rafraichirJournalier() {
  const user = await verifySession();
  requireModule(user, "stock");
  revalidatePath("/stock/journalier");
}
