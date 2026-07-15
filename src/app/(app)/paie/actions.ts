"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { tachesBloquantesCloture } from "@/lib/cloture-paie";
import { journaliser } from "@/lib/audit";
import { transitionAutorisee, roleRequisPour } from "@/lib/paie-etats";
import { rafraichirPaieDuMois, STATUTS_FIGES } from "@/lib/paie-refresh";
import type { ModePaiement, PaymentStatus, Prisma } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";

export async function calculerPaieDuMois() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  // Cœur partagé avec le rafraîchissement automatique de la page Paie (lib/paie-refresh) :
  // crée le run du mois si besoin et (re)calcule toutes les lignes non figées, avec audit.
  await rafraichirPaieDuMois({ creerRun: true, userId: user.id });

  revalidatePath("/paie");
  revalidatePath("/accueil");
  revalidatePath("/employes");
}

/**
 * Recalcule la paie du mois courant UNIQUEMENT si elle a déjà été calculée (une PayrollRun existe),
 * afin de répercuter un changement de prime / acompte / frais médical sur les lignes non figées
 * (les lignes VALIDÉES/PAYÉES sont préservées par calculerPaieDuMois). Ne crée jamais de run.
 * À appeler après toute modification qui doit se refléter sur le bulletin en cours.
 */
export async function recalculerPaieSiCalculee() {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  if (!config) return;
  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
  });
  if (run) await calculerPaieDuMois();
}

/**
 * Cœur d'une transition de la machine à états de paie (En attente → Préparé → Validé → Payé,
 * annulation possible). Enregistre la transition, journalise l'audit, fige un snapshot immuable
 * du bulletin au passage en « Validé ». Retourne false si la transition n'est pas autorisée
 * (en lot : on ignore silencieusement les lignes non concernées). S'exécute dans la transaction
 * fournie par l'appelant (unitaire : la sienne ; lot : UNE transaction pour tout le lot — tout ou
 * rien). NE vérifie pas le rôle ni ne revalide — l'appelant s'en charge.
 */
async function appliquerTransitionPaie(
  tx: Prisma.TransactionClient,
  payrollLineId: string,
  versStatut: PaymentStatus,
  opts: { modePaiement?: ModePaiement | null; preuveUrl?: string | null; commentaire?: string | null },
  userId: string
): Promise<boolean> {
  const ligne = await tx.payrollLine.findUnique({
    where: { id: payrollLineId },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne || !transitionAutorisee(ligne.statutPaiement, versStatut)) return false;

  const deStatut = ligne.statutPaiement;
  // Moyen de paiement : celui explicitement choisi, sinon le moyen de paiement de la fiche employé
  // — plus jamais « espèces » imposé par défaut, y compris pour les actions groupées.
  const modePaiement = opts.modePaiement ?? ligne.employee.modePaiement;

  await tx.payrollLine.update({
    where: { id: payrollLineId },
    data: {
      statutPaiement: versStatut,
      datePaiement: versStatut === "PAYE" ? new Date() : ligne.datePaiement,
      modePaiement: versStatut === "PAYE" ? modePaiement : ligne.modePaiement,
      payeParId: versStatut === "PAYE" ? userId : ligne.payeParId,
    },
  });

  await tx.transitionPaie.create({
    data: {
      payrollLineId,
      deStatut,
      versStatut,
      userId,
      modePaiement: versStatut === "PAYE" ? modePaiement : null,
      preuveUrl: opts.preuveUrl ?? null,
      commentaire: opts.commentaire ?? null,
    },
  });

  // Au passage en « Validé », on fige un snapshot immuable du bulletin (jamais écrasé ensuite).
  if (versStatut === "VALIDE") {
    const dernier = await tx.versionBulletin.findFirst({
      where: { payrollLineId },
      orderBy: { numeroVersion: "desc" },
    });
    await tx.versionBulletin.create({
      data: {
        payrollLineId,
        numeroVersion: (dernier?.numeroVersion ?? 0) + 1,
        snapshot: JSON.parse(JSON.stringify({ ligne, employe: ligne.employee, run: ligne.payrollRun })),
        genreParId: userId,
      },
    });
  }

  await journaliser(tx, {
    entite: "PayrollLine",
    entiteId: payrollLineId,
    champ: "statutPaiement",
    ancienneValeur: deStatut,
    nouvelleValeur: versStatut,
    userId,
  });

  return true;
}

/** Transition d'UNE ligne de paie (depuis un formulaire). */
export async function changerStatutPaie(payrollLineId: string, formData: FormData) {
  const user = await verifySession();
  const versStatut = String(formData.get("versStatut")) as PaymentStatus;
  const modePaiement = (formData.get("modePaiement") as ModePaiement | null) || null;
  const preuveUrl = String(formData.get("preuveUrl") ?? "").trim() || null;
  const commentaire = String(formData.get("commentaire") ?? "").trim() || null;

  requireRole(user, roleRequisPour(versStatut));

  const ok = await prisma.$transaction((tx) =>
    appliquerTransitionPaie(tx, payrollLineId, versStatut, { modePaiement, preuveUrl, commentaire }, user.id)
  );
  // Message lisible via ?erreur= (un throw serait masqué par Next en production).
  if (!ok) redirect(`/paie?erreur=${encodeURIComponent(`Transition non autorisée vers ${versStatut}.`)}`);

  revalidatePath("/paie");
  revalidatePath("/accueil");
  revalidatePath("/a-valider");
}

/**
 * ACTION GROUPÉE : applique la même transition à plusieurs lignes d'un coup (gain de temps).
 * Les lignes pour lesquelles la transition n'est pas autorisée sont ignorées. Retourne le
 * nombre de lignes effectivement modifiées.
 */
export const changerStatutEnLot = actionLisible(async (
  payrollLineIds: string[],
  versStatut: PaymentStatus,
  modePaiement?: ModePaiement | null
): Promise<number> => {
  const user = await verifySession();
  requireRole(user, roleRequisPour(versStatut));

  // ATOMIQUE : tout ou rien — un échec au milieu annule TOUT le lot (jamais de paie à moitié
  // validée). Les lignes dont la transition n'est pas autorisée restent simplement ignorées.
  const modifiees = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const id of payrollLineIds) {
      if (await appliquerTransitionPaie(tx, id, versStatut, { modePaiement }, user.id)) n++;
    }
    return n;
  }, { timeout: 120_000 });

  revalidatePath("/paie");
  revalidatePath("/accueil");
  revalidatePath("/a-valider");
  return modifiees;
});

/**
 * CLÔTURE GLOBALE (§9) : valide d'un coup tous les bulletins « pas validé » du mois.
 * BLOQUÉE s'il reste des tâches à traiter (acompte non traité, contrat à échéance, période
 * d'essai). Tracée à l'audit. Réservée à l'Admin.
 */
export async function cloturerPaie(): Promise<void> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });

  const taches = await tachesBloquantesCloture(config.moisCourant, config.anneeCourante);
  if (taches.length > 0) {
    // Message lisible via ?erreur= (un throw serait masqué par Next en production).
    redirect(
      `/paie?erreur=${encodeURIComponent(`Clôture bloquée : ${taches.length} tâche(s) à traiter avant de valider la paie (voir la bannière).`)}`
    );
  }

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
    include: { lignes: { where: { statutPaiement: "PAS_VALIDE" }, select: { id: true } } },
  });
  if (!run) return;

  // ATOMIQUE : tous les bulletins et l'état du run basculent dans UNE transaction.
  await prisma.$transaction(async (tx) => {
    for (const l of run.lignes) {
      await appliquerTransitionPaie(tx, l.id, "VALIDE", {}, user.id);
    }
    await tx.payrollRun.update({ where: { id: run.id }, data: { statut: "VALIDE" } });
  }, { timeout: 120_000 });

  revalidatePath("/paie");
  revalidatePath("/a-valider");
  revalidatePath("/accueil");
}

/**
 * Réinitialise la paie du mois en cours. Refuse si des salaires sont déjà validés ou payés
 * (bulletins émis non destructibles) — il faut d'abord les annuler explicitement.
 * N'affecte pas l'historique des mois passés.
 */
export async function reinitialiserPaieDuMois() {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
    include: { lignes: { select: { statutPaiement: true } } },
  });
  if (!run) redirect(`/paie?msg=${encodeURIComponent("Aucune paie à réinitialiser pour ce mois.")}`);

  const figees = run.lignes.filter((l) => STATUTS_FIGES.includes(l.statutPaiement)).length;
  if (figees > 0) {
    // Bulletins validés/payés protégés : message clair au lieu de faire planter la page.
    redirect(
      `/paie?erreur=${encodeURIComponent(
        `${figees} bulletin(s) validé(s)/payé(s) ce mois : rouvrez-les d'abord (sous-onglet « Valider les bulletins ») avant de réinitialiser.`
      )}`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.delete({ where: { id: run.id } });
    await journaliser(tx, {
      entite: "PayrollRun",
      entiteId: run.id,
      champ: "suppression",
      ancienneValeur: `${config.moisCourant}/${config.anneeCourante} (${run.lignes.length} lignes)`,
      userId: user.id,
    });
  });

  revalidatePath("/paie");
  revalidatePath("/accueil");
  redirect(`/paie?msg=${encodeURIComponent("Paie du mois réinitialisée.")}`);
}
