"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { tachesBloquantesCloture } from "@/lib/cloture-paie";
import { journaliser } from "@/lib/audit";
import { transitionAutorisee, transitionAutoriseeEnLot, roleRequisPour } from "@/lib/paie-etats";
import { rafraichirPaieDuMois, STATUTS_FIGES } from "@/lib/paie-refresh";
import { calculerEcheancePret } from "@/lib/prets";
import { fraisMedicauxARestituer, type TraceValidation } from "@/lib/paie-frais-medicaux";
import type { ModePaiement, PaymentStatus, Prisma } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";
import {
  controlerLignesAValider,
  DELAI_VALIDATION_PAIE,
  messageErreurValidation,
  ValidationPaieRefuseeError,
  verrouillerRunExclusif,
} from "@/lib/paie-validation";
import { estAttenteVerrouTropLongue, estInterblocage } from "@/lib/planning-ecriture";

const MESSAGE_CALCUL_OCCUPE = "Le planning ou la paie est en cours de modification : relancez le calcul dans un instant.";

export async function calculerPaieDuMois() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  // Cœur partagé avec le rafraîchissement automatique de la page Paie (lib/paie-refresh) :
  // crée le run du mois si besoin et (re)calcule toutes les lignes non figées, avec audit.
  // Le recalcul attend la fin d'une écriture du planning ou d'une validation en cours (verrou de la
  // run) : une attente trop longue revient en message lisible, jamais en page d'erreur.
  try {
    await rafraichirPaieDuMois({ creerRun: true, userId: user.id });
  } catch (e) {
    if (!estAttenteVerrouTropLongue(e) && !estInterblocage(e)) throw e;
    redirect(`/paie?erreur=${encodeURIComponent(MESSAGE_CALCUL_OCCUPE)}`);
  }

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
 *
 * `controlees` : ids rendus par `controlerLignesAValider` dans CETTE transaction (verrou + recalcul +
 * comparaison au centime). Une ligne PAS_VALIDE absente de ce jeu n'est jamais validée : un appelant
 * qui oublierait le contrôle figerait un montant que personne n'a revérifié.
 */
async function appliquerTransitionPaie(
  tx: Prisma.TransactionClient,
  payrollLineId: string,
  versStatut: PaymentStatus,
  opts: { modePaiement?: ModePaiement | null; preuveUrl?: string | null; commentaire?: string | null; enLot?: boolean; controlees?: Set<string> },
  userId: string
): Promise<boolean> {
  const ligne = await tx.payrollLine.findUnique({
    where: { id: payrollLineId },
    include: { employee: true, payrollRun: true },
  });
  const autorisee = opts.enLot ? transitionAutoriseeEnLot : transitionAutorisee;
  if (!ligne || !autorisee(ligne.statutPaiement, versStatut)) return false;
  if (versStatut === "VALIDE" && ligne.statutPaiement === "PAS_VALIDE" && !opts.controlees?.has(payrollLineId)) {
    throw new Error(`appliquerTransitionPaie : ligne ${payrollLineId} validée sans contrôle du montant (controlerLignesAValider)`);
  }

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

  // Frais médicaux de la fiche remis à zéro par CETTE transition : seulement une vraie validation
  // (PAS_VALIDE → VALIDÉ). Annuler un paiement (PAYÉ → VALIDÉ) ne touche pas la fiche : la ligne
  // reste figée et un montant saisi depuis pour un autre bulletin ne doit pas disparaître.
  const fraisFiche = Number(ligne.employee.fraisMedicauxMoisCourant);
  const remisAZero = versStatut === "VALIDE" && deStatut === "PAS_VALIDE" ? fraisFiche : 0;

  // Au passage en « Validé », on fige un snapshot immuable du bulletin (jamais écrasé ensuite).
  if (versStatut === "VALIDE") {
    const dernier = await tx.versionBulletin.findFirst({
      where: { payrollLineId },
      orderBy: { numeroVersion: "desc" },
    });
    const validation: TraceValidation = { deStatut, fraisMedicauxFicheRemisAZeroUSD: remisAZero };
    await tx.versionBulletin.create({
      data: {
        payrollLineId,
        numeroVersion: (dernier?.numeroVersion ?? 0) + 1,
        snapshot: JSON.parse(JSON.stringify({ ligne, employe: ligne.employee, run: ligne.payrollRun, validation })),
        genreParId: userId,
      },
    });

    // Remboursement de prêt : au figeage du bulletin, on enregistre l'échéance du mois (diminue le
    // solde) et on solde le prêt quand il est totalement remboursé. Idempotent (unique mois/année).
    if (Number(ligne.retenuePretUSD) > 0) {
      const prets = await tx.pretPersonnel.findMany({ where: { employeeId: ligne.employeeId, statut: "EN_COURS" }, include: { retenues: true } });
      for (const p of prets) {
        const { echeanceUSD, soldeAvantUSD } = calculerEcheancePret(
          Number(p.montantUSD),
          Number(p.retenueMensuelleUSD),
          p.retenues.map((r) => ({ mois: r.mois, annee: r.annee, montantUSD: Number(r.montantUSD) })),
          ligne.payrollRun.mois,
          ligne.payrollRun.annee
        );
        if (echeanceUSD <= 0) continue;
        await tx.retenuePret.upsert({
          where: { pretId_mois_annee: { pretId: p.id, mois: ligne.payrollRun.mois, annee: ligne.payrollRun.annee } },
          create: { pretId: p.id, mois: ligne.payrollRun.mois, annee: ligne.payrollRun.annee, montantUSD: echeanceUSD },
          update: { montantUSD: echeanceUSD },
        });
        if (soldeAvantUSD - echeanceUSD <= 0.001) await tx.pretPersonnel.update({ where: { id: p.id }, data: { statut: "SOLDE" } });
      }
    }

    // Frais médicaux (bug #1, corrigé 2026-07-22) : le solde « saisie manuelle du mois » de la
    // fiche employé (Employee.fraisMedicauxMoisCourant) est capturé dans CETTE ligne figée
    // (ligne.fraisMedicauxUSD, déjà persisté ci-dessus) — on le remet à zéro SEULEMENT maintenant,
    // au moment où le bulletin est réellement validé (jamais sur un simple rafraîchissement de
    // brouillon), pour ne pas le réappliquer par erreur le mois suivant (double comptage). La table
    // durable `FraisMedical` (avec certificat, scopée mois/année) n'est pas concernée.
    // Tracé au journal, et restitué à la fiche si la ligne est rouverte (voir plus bas).
    if (remisAZero !== 0) {
      await tx.employee.update({
        where: { id: ligne.employeeId },
        data: { fraisMedicauxMoisCourant: 0 },
      });
      await journaliser(tx, {
        entite: "Employee",
        entiteId: ligne.employeeId,
        champ: "fraisMedicauxMoisCourant",
        ancienneValeur: remisAZero,
        nouvelleValeur: 0,
        userId,
      });
    }
  }

  // Réouverture (VALIDÉ → PAS_VALIDE) — décision Direction 2026-09-24 : les frais médicaux que la
  // validation avait remis à zéro reviennent sur la fiche, dans la même transaction, et le recalcul
  // les retrouve. Ajoutés (jamais écrasés) : un montant saisi depuis sur la fiche est conservé. La
  // revalidation les remet à zéro une fois, comme toute validation : ni perte ni doublon.
  if (deStatut === "VALIDE" && versStatut === "PAS_VALIDE") {
    const [versions, transitions] = await Promise.all([
      tx.versionBulletin.findMany({ where: { payrollLineId }, orderBy: { numeroVersion: "desc" }, select: { snapshot: true } }),
      tx.transitionPaie.findMany({ where: { payrollLineId, versStatut: "VALIDE" }, select: { deStatut: true } }),
    ]);
    const aRestituer = fraisMedicauxARestituer(
      versions.map((v) => v.snapshot as Parameters<typeof fraisMedicauxARestituer>[0][number]),
      transitions.map((t) => t.deStatut),
    );
    if (aRestituer !== 0) {
      const apres = await tx.employee.update({
        where: { id: ligne.employeeId },
        data: { fraisMedicauxMoisCourant: { increment: aRestituer } },
        select: { fraisMedicauxMoisCourant: true },
      });
      await journaliser(tx, {
        entite: "Employee",
        entiteId: ligne.employeeId,
        champ: "fraisMedicauxMoisCourant",
        ancienneValeur: Number(apres.fraisMedicauxMoisCourant) - aRestituer,
        nouvelleValeur: Number(apres.fraisMedicauxMoisCourant),
        userId,
      });
    }
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

  // Valider revérifie le montant (verrou + recalcul du mois + comparaison au centime) : délai du
  // recalcul, refus renvoyé en message lisible, rien d'écrit.
  let ok = false;
  let refus: string | null = null;
  try {
    ok = await prisma.$transaction(async (tx) => {
      const controlees = versStatut === "VALIDE" ? await controlerLignesAValider(tx, [payrollLineId]) : undefined;
      return appliquerTransitionPaie(tx, payrollLineId, versStatut, { modePaiement, preuveUrl, commentaire, controlees }, user.id);
    }, { timeout: DELAI_VALIDATION_PAIE });
  } catch (e) {
    refus = messageErreurValidation(e);
    if (!refus) throw e;
  }
  // Message lisible via ?erreur= (un throw serait masqué par Next en production).
  if (refus) redirect(`/paie?erreur=${encodeURIComponent(refus)}`);
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
  // Valider revérifie les montants : UN recalcul par mois pour tout le lot, et une seule ligne
  // changée refuse le lot entier (message lisible via `actionLisible`).
  let modifiees: number;
  try {
    modifiees = await prisma.$transaction(async (tx) => {
      const controlees = versStatut === "VALIDE" ? await controlerLignesAValider(tx, payrollLineIds) : undefined;
      let n = 0;
      for (const id of payrollLineIds) {
        if (await appliquerTransitionPaie(tx, id, versStatut, { modePaiement, enLot: true, controlees }, user.id)) n++;
      }
      return n;
    }, { timeout: DELAI_VALIDATION_PAIE });
  } catch (e) {
    const refus = messageErreurValidation(e);
    throw refus ? new ValidationPaieRefuseeError(refus) : e;
  }

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
    select: { id: true },
  });
  if (!run) return;

  // ATOMIQUE : tous les bulletins et l'état du run basculent dans UNE transaction. Chaque montant
  // est revérifié (run prise d'emblée en FOR UPDATE : la clôture la modifie ensuite) ; une seule
  // ligne changée refuse la clôture entière.
  let refus: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Lignes lues APRÈS le verrou de la run : un recalcul (/paie) ne peut plus les remplacer.
      await verrouillerRunExclusif(tx, run.id);
      const lignes = await tx.payrollLine.findMany({ where: { payrollRunId: run.id, statutPaiement: "PAS_VALIDE" }, select: { id: true } });
      const controlees = await controlerLignesAValider(tx, lignes.map((l) => l.id), { verrouRun: "EXCLUSIF" });
      for (const l of lignes) {
        await appliquerTransitionPaie(tx, l.id, "VALIDE", { controlees }, user.id);
      }
      await tx.payrollRun.update({ where: { id: run.id }, data: { statut: "VALIDE" } });
    }, { timeout: DELAI_VALIDATION_PAIE });
  } catch (e) {
    refus = messageErreurValidation(e);
    if (!refus) throw e;
  }
  if (refus) redirect(`/paie?erreur=${encodeURIComponent(`Clôture annulée (aucun bulletin validé) : ${refus}`)}`);

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
