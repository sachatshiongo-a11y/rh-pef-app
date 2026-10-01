"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { verifySession, requireRole } from "@/lib/auth";
import { tachesBloquantesCloture } from "@/lib/cloture-paie";
import { journaliser } from "@/lib/audit";
import { cloturePeutValider, roleRequisPour, ROLES_CLOTURE, transitionPermise } from "@/lib/paie-etats";
import { rafraichirPaieDuMois, lignesNonFigees, STATUTS_FIGES } from "@/lib/paie-refresh";
import { calculerEcheancePret } from "@/lib/prets";
import { fraisMedicauxARestituer, type TraceValidation } from "@/lib/paie-frais-medicaux";
import type { ModePaiement, PaymentStatus, Prisma, Role } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";
import {
  ATTENTE_VERROU_VALIDATION,
  messageAttenteDirection,
  controlerLignesAPayer,
  controlerLignesAValider,
  DELAI_VALIDATION_PAIE,
  messageErreurValidation,
  ValidationPaieRefuseeError,
  verrouillerLignesPaie,
  verrouillerRunExclusif,
} from "@/lib/paie-validation";
import { estAttenteVerrouTropLongue, estInterblocage } from "@/lib/planning-ecriture";
import { notifierBulletinsPayes, notifierBulletinsValides, notifierClotureParRH, notifierPaiementAnnule, retirerRappelSiRienAPayer } from "@/lib/paie-notifications";

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
 * du bulletin au passage en « Validé ». Retourne l'état de DÉPART de la ligne (null si la transition
 * n'est pas autorisée
 * (en lot : on ignore silencieusement les lignes non concernées). S'exécute dans la transaction
 * fournie par l'appelant (unitaire : la sienne ; lot : UNE transaction pour tout le lot — tout ou
 * rien). NE vérifie pas le rôle ni ne revalide — l'appelant s'en charge.
 *
 * `controlees` : ids rendus par `controlerLignesAValider` dans CETTE transaction (verrou + recalcul +
 * comparaison au centime). Une ligne PAS_VALIDE absente de ce jeu n'est jamais validée : un appelant
 * qui oublierait le contrôle figerait un montant que personne n'a revérifié.
 *
 * `payables` : ids rendus par `controlerLignesAPayer` (verrou + jeton des montants affichés). Une
 * ligne VALIDÉE absente de ce jeu n'est jamais payée.
 *
 * `acteur.role` : revérifié PAR LIGNE (machine à états ET droit du rôle, `transitionPermise`), en plus
 * du `requireRole` d'entrée — la RH ne paie que du VALIDÉ, ne valide et ne rouvre jamais rien.
 */
async function appliquerTransitionPaie(
  tx: Prisma.TransactionClient,
  payrollLineId: string,
  versStatut: PaymentStatus,
  opts: { modePaiement?: ModePaiement | null; preuveUrl?: string | null; commentaire?: string | null; enLot?: boolean; controlees?: Set<string>; payables?: Set<string>; maintenant?: Date },
  acteur: { id: string; role: Role }
): Promise<PaymentStatus | null> {
  const userId = acteur.id;
  // La ligne est lue SOUS VERROU : son état ne peut plus changer entre la lecture et l'écriture
  // (les appelants l'ont déjà verrouillée dans l'ordre des id ; ici, ceinture et bretelles).
  await tx.$queryRaw`SELECT "id" FROM "public"."PayrollLine" WHERE "id" = ${payrollLineId} FOR UPDATE`;
  const ligne = await tx.payrollLine.findUnique({
    where: { id: payrollLineId },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne || !transitionPermise(acteur.role, ligne.statutPaiement, versStatut, { enLot: opts.enLot })) return null;
  if (versStatut === "VALIDE" && ligne.statutPaiement === "PAS_VALIDE" && !opts.controlees?.has(payrollLineId)) {
    throw new Error(`appliquerTransitionPaie : ligne ${payrollLineId} validée sans contrôle du montant (controlerLignesAValider)`);
  }
  if (versStatut === "PAYE" && !opts.payables?.has(payrollLineId)) {
    throw new Error(`appliquerTransitionPaie : ligne ${payrollLineId} payée sans contrôle des montants affichés (controlerLignesAPayer)`);
  }

  const deStatut = ligne.statutPaiement;
  // Moyen de paiement : celui explicitement choisi, sinon le moyen de paiement de la fiche employé
  // — plus jamais « espèces » imposé par défaut, y compris pour les actions groupées.
  const modePaiement = opts.modePaiement ?? ligne.employee.modePaiement;

  await tx.payrollLine.update({
    where: { id: payrollLineId },
    data: {
      statutPaiement: versStatut,
      datePaiement: versStatut === "PAYE" ? (opts.maintenant ?? new Date()) : ligne.datePaiement,
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

  return deStatut;
}

/** Transition d'UNE ligne de paie (depuis un formulaire). */
export async function changerStatutPaie(payrollLineId: string, formData: FormData) {
  const user = await verifySession();
  const versStatut = String(formData.get("versStatut")) as PaymentStatus;
  const modePaiement = (formData.get("modePaiement") as ModePaiement | null) || null;
  const preuveUrl = String(formData.get("preuveUrl") ?? "").trim() || null;
  const commentaire = String(formData.get("commentaire") ?? "").trim() || null;
  // Montants que l'écran a montrés (paie-jeton.ts) : une ligne recalculée depuis est refusée.
  const jeton = String(formData.get("jeton") ?? "").trim() || undefined;

  // Payer : Direction ET RH ; valider, rouvrir, annuler un paiement : Direction seule (paie-etats.ts).
  requireRole(user, roleRequisPour(versStatut));

  // Valider revérifie le montant (verrou + recalcul du mois + comparaison au centime) : délai du
  // recalcul, refus renvoyé en message lisible, rien d'écrit. Payer revérifie les montants affichés
  // (jeton, taux de change compris).
  let de: PaymentStatus | null = null;
  let refus: string | null = null;
  const maintenant = new Date(); // l'instant du paiement (et de sa notification)
  try {
    de = await prisma.$transaction(async (tx) => {
      if (versStatut === "PAS_VALIDE") await verrouillerLignesPaie(tx, [payrollLineId]); // attente bornée
      // Jeton OBLIGATOIRE pour valider et payer, Direction comme RH (2026-10-01) : l'écran l'envoie
      // toujours ; sans lui, personne n'a lu le montant. (Annuler un paiement n'en exige pas.)
      const controlees = versStatut === "VALIDE" ? await controlerLignesAValider(tx, [payrollLineId], { jetons: { [payrollLineId]: jeton }, jetonObligatoire: true }) : undefined;
      const payables = versStatut === "PAYE" ? await controlerLignesAPayer(tx, [payrollLineId], { jetons: { [payrollLineId]: jeton }, jetonObligatoire: true }) : undefined;
      return appliquerTransitionPaie(tx, payrollLineId, versStatut, { modePaiement, preuveUrl, commentaire, controlees, payables, maintenant }, user);
    }, { timeout: DELAI_VALIDATION_PAIE });
  } catch (e) {
    refus = messageErreurValidation(e);
    if (!refus) throw e;
  }
  // Message lisible via ?erreur= (un throw serait masqué par Next en production).
  if (refus) redirect(`/paie?erreur=${encodeURIComponent(refus)}`);
  if (!de) {
    // Double clic, ou bulletin payé par l'autre acteur entre-temps : le dire, pas « non validé ».
    const actuel = versStatut === "PAYE" ? (await prisma.payrollLine.findUnique({ where: { id: payrollLineId }, select: { statutPaiement: true } }))?.statutPaiement : null;
    redirect(`/paie?erreur=${encodeURIComponent(
      versStatut !== "PAYE"
        ? `Transition non autorisée vers ${versStatut}.`
        : actuel === "PAYE"
          ? "Ce bulletin est déjà payé."
          : "Seul un bulletin validé par la Direction peut être marqué payé : rechargez la page.",
    )}`);
  }

  // Après la transaction : la RH apprend ce qui est à payer (ou à payer de nouveau), la Direction ce
  // que la RH a payé ; un rappel « à payer » devenu sans objet disparaît.
  if (versStatut === "VALIDE" && de === "PAS_VALIDE") await notifierBulletinsValides([payrollLineId], user.id);
  if (versStatut === "VALIDE" && de === "PAYE") await notifierPaiementAnnule([payrollLineId], user.id);
  if (versStatut === "PAYE") await notifierBulletinsPayes([payrollLineId], user, maintenant);
  if (versStatut === "PAS_VALIDE") await retirerRappelSiRienAPayer([payrollLineId]);

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
  modePaiement?: ModePaiement | null,
  /** Montants affichés par ligne (paie-jeton.ts) : une ligne recalculée depuis l'affichage refuse le lot. */
  jetons?: Record<string, string>,
): Promise<number> => {
  const user = await verifySession();
  // Payer : Direction ET RH ; valider, rouvrir : Direction seule (paie-etats.ts).
  requireRole(user, roleRequisPour(versStatut));

  // ATOMIQUE : tout ou rien — un échec au milieu annule TOUT le lot (jamais de paie à moitié
  // validée). Les lignes dont la transition n'est pas autorisée restent simplement ignorées (une
  // ligne NON VALIDÉE glissée dans un lot « Marquer payé » n'est jamais payée).
  // Valider revérifie les montants : UN recalcul par mois pour tout le lot, et une seule ligne
  // changée refuse le lot entier (message lisible via `actionLisible`). Valider et payer exigent les
  // montants affichés de chaque ligne concernée (jeton, taux de change compris).
  const modifiees: string[] = [];
  const maintenant = new Date(); // UN instant de paiement pour tout le lot
  try {
    await prisma.$transaction(async (tx) => {
      modifiees.length = 0; // une transaction rejouée repart de zéro
      // Rouvrir : les lignes verrouillées dans l'ordre des id AVANT d'être lues (un paiement
      // concurrent est attendu, jamais écrasé). Valider et payer verrouillent dans leur contrôle.
      if (versStatut === "PAS_VALIDE") await verrouillerLignesPaie(tx, payrollLineIds);
      const controlees = versStatut === "VALIDE" ? await controlerLignesAValider(tx, payrollLineIds, { jetons, jetonObligatoire: true }) : undefined;
      const payables = versStatut === "PAYE" ? await controlerLignesAPayer(tx, payrollLineIds, { jetons, jetonObligatoire: true }) : undefined;
      for (const id of payrollLineIds) {
        if (await appliquerTransitionPaie(tx, id, versStatut, { modePaiement, enLot: true, controlees, payables, maintenant }, user)) modifiees.push(id);
      }
    }, { timeout: DELAI_VALIDATION_PAIE });
  } catch (e) {
    const refus = messageErreurValidation(e);
    throw refus ? new ValidationPaieRefuseeError(refus) : e;
  }

  // Après la transaction (jamais avant : une notification n'annonce pas un lot annulé).
  if (versStatut === "VALIDE") await notifierBulletinsValides(modifiees, user.id); // en lot : jamais depuis « Payé »
  if (versStatut === "PAYE") await notifierBulletinsPayes(modifiees, user, maintenant);
  if (versStatut === "PAS_VALIDE") await retirerRappelSiRienAPayer(modifiees);

  revalidatePath("/paie");
  revalidatePath("/accueil");
  revalidatePath("/a-valider");
  return modifiees.length;
});

/**
 * CLÔTURE GLOBALE (§9) : valide d'un coup tous les bulletins « pas validé » du mois.
 * BLOQUÉE s'il reste des tâches à traiter (acompte non traité, contrat à échéance, période
 * d'essai). Tracée à l'audit (chaque transition porte son auteur réel).
 * Direction ET RH depuis le 2026-10-01 (décision de Sacha) :
 *  - la Direction : comportement inchangé (valide les « pas validé » comptés, puis ferme la paie) ;
 *  - la RH : seulement une paie que la Direction a ENTIÈREMENT validée — s'il reste un bulletin
 *    compté « pas validé », refus lisible et rien d'écrit. Sa clôture ne valide rien : elle ferme la
 *    paie (PayrollRun « Validé » : pointage et import de présences du mois fermés). Les lignes hors
 *    calcul sont laissées de côté comme pour la Direction. La Direction en est prévenue.
 * Ne change PAS de mois (Paramètres > mois en cours : geste distinct, Direction seule).
 */
export async function cloturerPaie(): Promise<void> {
  const user = await verifySession();
  requireRole(user, ROLES_CLOTURE);
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
  const validees: string[] = [];
  let horsCalculLaissees = 0;
  let dejaCloturee = false;
  const valideEnCloturant = cloturePeutValider(user.role);
  try {
    await prisma.$transaction(async (tx) => {
      validees.length = 0;
      // Lignes lues APRÈS le verrou de la run : un recalcul (/paie) ne peut plus les remplacer.
      await verrouillerRunExclusif(tx, run.id);
      dejaCloturee = (await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id }, select: { statut: true } })).statut === "VALIDE";
      if (!valideEnCloturant) {
        // RH : toutes les lignes du mois verrouillées (FOR SHARE) AVANT de lire leur état. Une
        // réouverture en cours (Direction) se termine d'abord et la ligne est lue « pas validé »
        // (refus) ; une réouverture qui arrive ensuite attend la clôture — jamais une paie fermée
        // sur un état déjà périmé au moment de la lecture.
        await tx.$queryRaw`SELECT l."id" FROM "public"."PayrollLine" l WHERE l."payrollRunId" = ${run.id} ORDER BY l."id" FOR SHARE`;
      }
      // Les lignes HORS CALCUL (ligne rouverte d'un salarié sorti du calcul, paie-hors-calcul.ts) ne
      // comptent nulle part et ne se valident pas : la clôture les laisse de côté, PAS VALIDÉES, au
      // lieu de rester bloquée sur elles (la réinitialisation ne les supprime plus, 2026-10-01).
      const pasValidees = await tx.payrollLine.findMany({ where: { payrollRunId: run.id, statutPaiement: "PAS_VALIDE" }, select: { id: true, employeeId: true, statutPaiement: true } });
      const lignes = await lignesComptees(tx, pasValidees);
      horsCalculLaissees = pasValidees.length - lignes.length;
      if (!valideEnCloturant && lignes.length > 0) throw new ValidationPaieRefuseeError(messageAttenteDirection(lignes.length));
      const controlees = await controlerLignesAValider(tx, lignes.map((l) => l.id), { verrouRun: "EXCLUSIF" });
      for (const l of lignes) {
        if (await appliquerTransitionPaie(tx, l.id, "VALIDE", { controlees }, user)) validees.push(l.id);
      }
      await tx.payrollRun.update({ where: { id: run.id }, data: { statut: "VALIDE" } });
    }, { timeout: DELAI_VALIDATION_PAIE });
  } catch (e) {
    refus = messageErreurValidation(e);
    if (!refus) throw e;
  }
  if (refus) {
    redirect(`/paie?erreur=${encodeURIComponent(valideEnCloturant ? `Clôture annulée (aucun bulletin validé) : ${refus}` : `Clôture refusée : ${refus}`)}`);
  }

  // Après la transaction, jamais bloquant : la clôture de la Direction valide → la RH apprend ce qui
  // est à payer ; la RH a fermé la paie → la Direction le sait (une paie déjà close : rien à dire).
  await notifierBulletinsValides(validees, user.id);
  if (!valideEnCloturant && !dejaCloturee) await notifierClotureParRH({ payrollRunId: run.id, nom: user.nom, horsCalcul: horsCalculLaissees });

  revalidatePath("/paie");
  revalidatePath("/a-valider");
  revalidatePath("/accueil");
}

/**
 * Réinitialise la paie du mois en cours. Refuse si des salaires sont déjà validés ou payés
 * (bulletins émis non destructibles) — il faut d'abord les annuler explicitement.
 * N'affecte pas l'historique des mois passés.
 *
 * UN BULLETIN DÉJÀ REMIS NE DISPARAÎT JAMAIS (décision de Sacha du 2026-10-01). Une ligne rouverte
 * qui a un historique (bulletin émis, transition, attestation, signature, journal) est CONSERVÉE :
 * ses bulletins remis restent en archive (VersionBulletin, consultables depuis la fiche du salarié),
 * et ses montants sont recalculés par le vrai calcul. Seuls les brouillons sans historique sont
 * supprimés ; la paie elle-même (PayrollRun) n'est supprimée que s'il ne reste AUCUNE ligne à
 * historique — elle ne contient alors que des brouillons, rien d'émis.
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

  // Run verrouillée FOR UPDATE (comme le recalcul) : une validation ou un recalcul concurrent attend.
  let resultat: { gardees: number; bulletinsRemis: number; figeesEntreTemps: number };
  try {
    resultat = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${ATTENTE_VERROU_VALIDATION}'`);
      await tx.$queryRaw`SELECT "id" FROM "public"."PayrollRun" WHERE "id" = ${run.id} FOR UPDATE`;
      const figeesEntreTemps = await tx.payrollLine.count({ where: { payrollRunId: run.id, statutPaiement: { in: STATUTS_FIGES } } });
      if (figeesEntreTemps > 0) return { gardees: 0, bulletinsRemis: 0, figeesEntreTemps };
      const { existantes, aHistorique } = await lignesNonFigees(tx, run.id);
      const gardees = existantes.filter(aHistorique);
      const brouillons = existantes.filter((l) => !aHistorique(l)).map((l) => l.id);
      if (gardees.length === 0) {
        // Rien d'émis ni de tracé : la paie du mois n'est faite que de brouillons, elle part entière.
        await tx.payrollRun.delete({ where: { id: run.id } });
        await journaliser(tx, {
          entite: "PayrollRun",
          entiteId: run.id,
          champ: "suppression",
          ancienneValeur: `${config.moisCourant}/${config.anneeCourante} (${run.lignes.length} lignes)`,
          userId: user.id,
        });
        return { gardees: 0, bulletinsRemis: 0, figeesEntreTemps: 0 };
      }
      if (brouillons.length) await tx.payrollLine.deleteMany({ where: { id: { in: brouillons } } });
      const bulletinsRemis = await tx.versionBulletin.count({ where: { payrollLineId: { in: gardees.map((l) => l.id) } } });
      await journaliser(tx, {
        entite: "PayrollRun",
        entiteId: run.id,
        champ: "reinitialisation",
        ancienneValeur: `${config.moisCourant}/${config.anneeCourante} (${run.lignes.length} lignes)`,
        nouvelleValeur: `${brouillons.length} brouillon(s) supprimé(s) ; ${gardees.length} ligne(s) avec historique conservée(s) (${bulletinsRemis} bulletin(s) remis en archive)`,
        userId: user.id,
      });
      return { gardees: gardees.length, bulletinsRemis, figeesEntreTemps: 0 };
    }, { timeout: 60_000 });
  } catch (e) {
    // Verrou tenu trop longtemps (validation, recalcul ou planning en cours) : message lisible.
    const refus = messageErreurValidation(e);
    if (!refus) throw e;
    redirect(`/paie?erreur=${encodeURIComponent(`Réinitialisation non faite : ${refus}`)}`);
  }
  const { gardees, bulletinsRemis, figeesEntreTemps } = resultat;
  if (figeesEntreTemps > 0) {
    redirect(`/paie?erreur=${encodeURIComponent(`${figeesEntreTemps} bulletin(s) validé(s)/payé(s) entre-temps : rien n'a été réinitialisé.`)}`);
  }
  // Lignes conservées : les montants du mois sont recalculés (en place) par le vrai calcul, les
  // brouillons recréés — exactement le recalcul du bouton « Calculer ».
  if (gardees > 0) await rafraichirPaieDuMois({ creerRun: false, userId: user.id });

  revalidatePath("/paie");
  revalidatePath("/accueil");
  redirect(`/paie?msg=${encodeURIComponent(
    gardees > 0
      ? `Paie du mois réinitialisée et recalculée : ${bulletinsRemis} bulletin(s) déjà remis conservé(s) en archive (fiche du salarié). Les lignes hors calcul gardent leurs montants.`
      : "Paie du mois réinitialisée.",
  )}`);
}
