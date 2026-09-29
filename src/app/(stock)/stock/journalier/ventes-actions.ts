"use server";

import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliser } from "@/lib/audit";
import { derniereClotureStock, estDansPeriodeFigee } from "@/lib/cloture-stock";
import { lireCleLigne, lireQuantiteVendue } from "@/lib/ventes-journalieres";

// Saisie case par case de la grille « Ventes » (Conso. journalière) : nombre vendu d'une unité de
// vente (fiche « Plat vendu » ou fiche Bar) un jour donné. Mêmes droits et même garde que la grille « Commande » (espace Stock).
// Comme elle, PAS de `revalidatePath` par case : la grille appelle `rafraichirJournalier` une fois
// la saisie au repos.
//
// Case vidée (null) = la saisie est RETIRÉE (plus de ligne : « — ») ; 0 = « rien vendu », ENREGISTRÉ.
// Une période de stock clôturée (Paramètres → Clôture mensuelle) est en lecture seule.
// Chaque changement est journalisé (avant → après), jamais une écriture muette.

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

function lireJour(dateIso: string): Date {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (!DATE_ISO.test(dateIso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateIso) {
    throw new Error("Date de vente invalide.");
  }
  return d;
}

/** Violation d'unicité Prisma (deux saisies simultanées de la même case). */
const estDoublon = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

/** Enregistre le nombre vendu d'une ligne (`fiche:<id>`) pour un jour ; null retire la saisie. */
export const saisirVente = actionLisible(async (ligne: string, dateIso: string, quantite: number | null) => {
  const user = await verifySession();
  requireModule(user, "stock");

  const date = lireJour(dateIso);
  const cible = lireCleLigne(ligne);
  if (!cible) throw new Error("Ligne de vente inconnue.");
  const q = lireQuantiteVendue(quantite);
  if (!q.ok) throw new Error(q.erreur);

  // La ligne existe et se vend : une fiche « Plat vendu » ou une fiche Bar, jamais une sous-recette.
  const f = await prisma.ficheTechnique.findUnique({ where: { id: cible.id }, select: { estSousRecette: true } });
  if (!f) throw new Error("Fiche introuvable (supprimée ?). Rechargez la page.");
  if (f.estSousRecette) throw new Error("Une sous-recette ne se vend pas : seules les fiches « Plat vendu » et Bar ont des ventes.");

  const borne = await derniereClotureStock();
  if (estDansPeriodeFigee(date, borne)) {
    const periode = `${String(borne!.mois).padStart(2, "0")}/${borne!.annee}`;
    throw new Error(`La période ${periode} est clôturée : les ventes du ${dateIso.split("-").reverse().join("/")} sont en lecture seule. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)`);
  }

  const where = { date_ficheId: { date, ficheId: cible.id } };
  try {
    await prisma.$transaction(async (tx) => {
      const avant = await tx.venteJournaliere.findUnique({ where, select: { quantite: true } });
      const ancienne = avant ? avant.quantite : null;
      if (ancienne === q.valeur) return; // rien ne change : ni écriture, ni journal
      if (q.valeur === null) {
        // deleteMany : idempotent — une case vidée deux fois de suite (ou depuis deux écrans) ne
        // lève pas d'erreur « enregistrement introuvable ».
        const { count } = await tx.venteJournaliere.deleteMany({ where: { date, ficheId: cible.id } });
        if (count === 0) return;
      } else {
        await tx.venteJournaliere.upsert({
          where,
          update: { quantite: q.valeur, saisiParId: user.id },
          create: { date, ficheId: cible.id, quantite: q.valeur, saisiParId: user.id },
        });
      }
      await journaliser(tx, { entite: "VenteJournaliere", entiteId: `${ligne}_${dateIso}`, champ: "quantite", ancienneValeur: ancienne, nouvelleValeur: q.valeur, userId: user.id });
    });
  } catch (e) {
    if (estDoublon(e)) throw new Error("Cette case vient d'être saisie ailleurs en même temps : rechargez la page, puis ressaisissez si besoin.");
    throw e;
  }
  return { ok: true as const };
});
