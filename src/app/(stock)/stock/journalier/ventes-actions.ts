"use server";

import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliser } from "@/lib/audit";
import { derniereClotureStock, estDansPeriodeFigee } from "@/lib/cloture-stock";
import { lireCleLigne, lireQuantiteVendue } from "@/lib/ventes-journalieres";

// Saisie case par case de la grille « Ventes » (Conso. journalière) : nombre vendu d'un plat ou
// d'une boisson un jour donné. Mêmes droits et même garde que la grille « Commande » (espace Stock).
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

/** Enregistre le nombre vendu d'une ligne (`fiche:<id>` ou `resto:<id>`) pour un jour ; null retire la saisie. */
export const saisirVente = actionLisible(async (ligne: string, dateIso: string, quantite: number | null) => {
  const user = await verifySession();
  requireModule(user, "stock");

  const date = lireJour(dateIso);
  const cible = lireCleLigne(ligne);
  if (!cible) throw new Error("Ligne de vente inconnue.");
  const q = lireQuantiteVendue(quantite);
  if (!q.ok) throw new Error(q.erreur);

  // La ligne existe et se vend : un plat (jamais une sous-recette) ou une boisson du bar.
  if (cible.type === "fiche") {
    const f = await prisma.ficheTechnique.findUnique({ where: { id: cible.id }, select: { estSousRecette: true } });
    if (!f) throw new Error("Plat introuvable (fiche supprimée ?). Rechargez la page.");
    if (f.estSousRecette) throw new Error("Une sous-recette ne se vend pas : seules les fiches « Plat vendu » ont des ventes.");
  } else {
    const a = await prisma.articleResto.findUnique({ where: { id: cible.id }, select: { espace: true } });
    if (!a) throw new Error("Boisson introuvable (article supprimé ?). Rechargez la page.");
    if (a.espace !== "BAR") throw new Error("Seuls les articles du bar ont des ventes au rapport journalier.");
  }

  const borne = await derniereClotureStock();
  if (estDansPeriodeFigee(date, borne)) {
    const periode = `${String(borne!.mois).padStart(2, "0")}/${borne!.annee}`;
    throw new Error(`La période ${periode} est clôturée : les ventes du ${dateIso.split("-").reverse().join("/")} sont en lecture seule. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)`);
  }

  const where = cible.type === "fiche"
    ? { date_ficheId: { date, ficheId: cible.id } }
    : { date_articleRestoId: { date, articleRestoId: cible.id } };
  const lien = cible.type === "fiche" ? { ficheId: cible.id } : { articleRestoId: cible.id };

  await prisma.$transaction(async (tx) => {
    const avant = await tx.venteJournaliere.findUnique({ where, select: { quantite: true } });
    const ancienne = avant ? avant.quantite : null;
    if (ancienne === q.valeur) return; // rien ne change : ni écriture, ni journal
    if (q.valeur === null) {
      await tx.venteJournaliere.delete({ where });
    } else {
      await tx.venteJournaliere.upsert({
        where,
        update: { quantite: q.valeur, saisiParId: user.id },
        create: { date, ...lien, quantite: q.valeur, saisiParId: user.id },
      });
    }
    await journaliser(tx, { entite: "VenteJournaliere", entiteId: `${ligne}_${dateIso}`, champ: "quantite", ancienneValeur: ancienne, nouvelleValeur: q.valeur, userId: user.id });
  });
  return { ok: true as const };
});
