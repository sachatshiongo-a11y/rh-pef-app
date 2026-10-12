"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliser } from "@/lib/audit";
import { exigerJourSaisissable, lireJourSaisie } from "@/lib/saisie-restaurant";

// Saisie case par case de la grille « Commande » (≈ 178 articles × 7 jours).
//
// PAS de `revalidatePath` ici : mesuré le 2026-09-24, chaque case validée renvoyait toute la page
// (3 requêtes Prisma côté serveur, puis les 178 lignes — 1 246 champs — re-rendues côté client),
// et les actions serveur passant l'une après l'autre, une saisie rapide empilait ces rechargements.
// La grille garde elle-même les valeurs saisies ; elle appelle `rafraichirJournalier` une fois la
// saisie au repos (et en quittant l'onglet), pour que les autres vues et l'historique du
// navigateur ne montrent pas une commande périmée.

function lireCase(dateIso: string, quantite: number) {
  let date: Date;
  try { date = lireJourSaisie(dateIso, "de commande"); } catch { throw new Error("Date de commande invalide."); }
  const q = Number(quantite);
  if (!Number.isFinite(q) || q < 0) throw new Error("Quantité invalide.");
  return { date, q };
}

// Audit du 10/10/2026 : une commande était réécrivable sans trace, mois clos compris. Désormais, comme
// pour les ventes (`saisirVente`) : période de stock clôturée en lecture seule, journal avant → après
// (0/vide = la ligne disparaît : « — »), auteur de la dernière saisie sur la ligne. Même quantité :
// ni écriture, ni journal.

/** Enregistre la quantité commandée d'un article pour un jour (0/vide = supprime la ligne). */
export const saisirCommandeResto = actionLisible(async (articleId: string, dateIso: string, quantite: number) => {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!articleId) throw new Error("Article manquant.");
  const { date, q } = lireCase(dateIso, quantite);
  await exigerJourSaisissable(date, "les commandes");
  await prisma.$transaction(async (tx) => {
    const avant = await tx.commandeResto.findUnique({ where: { articleId_date: { articleId, date } }, select: { quantite: true } });
    if (q === 0) {
      if (!avant) return;
      await tx.commandeResto.deleteMany({ where: { articleId, date } });
    } else {
      if (avant && avant.quantite.equals(q)) return;
      await tx.commandeResto.upsert({
        where: { articleId_date: { articleId, date } },
        update: { quantite: q, saisiParId: user.id },
        create: { articleId, date, quantite: q, saisiParId: user.id },
      });
    }
    await journaliser(tx, {
      entite: "CommandeResto", entiteId: `${articleId}_${dateIso}`, champ: "quantite",
      ancienneValeur: avant ? avant.quantite.toString() : null, nouvelleValeur: q === 0 ? null : q, userId: user.id,
    });
  });
  return { ok: true as const };
});

/** Idem pour un légume frais (liste figée, hors catalogue). */
export const saisirCommandeLegume = actionLisible(async (legume: string, dateIso: string, quantite: number) => {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!legume) throw new Error("Légume manquant.");
  const { date, q } = lireCase(dateIso, quantite);
  await exigerJourSaisissable(date, "les commandes");
  await prisma.$transaction(async (tx) => {
    const avant = await tx.commandeLegumeResto.findUnique({ where: { legume_date: { legume, date } }, select: { quantite: true } });
    if (q === 0) {
      if (!avant) return;
      await tx.commandeLegumeResto.deleteMany({ where: { legume, date } });
    } else {
      if (avant && avant.quantite.equals(q)) return;
      await tx.commandeLegumeResto.upsert({
        where: { legume_date: { legume, date } },
        update: { quantite: q, saisiParId: user.id },
        create: { legume, date, quantite: q, saisiParId: user.id },
      });
    }
    await journaliser(tx, {
      entite: "CommandeLegumeResto", entiteId: `${legume}_${dateIso}`, champ: "quantite",
      ancienneValeur: avant ? avant.quantite.toString() : null, nouvelleValeur: q === 0 ? null : q, userId: user.id,
    });
  });
  return { ok: true as const };
});

/** Une seule revalidation après une rafale de saisies (au lieu d'une par case). */
export async function rafraichirJournalier() {
  const user = await verifySession();
  requireModule(user, "stock");
  revalidatePath("/stock/journalier");
}
