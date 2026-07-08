"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { tachesBloquantesCloture } from "@/lib/cloture-paie";
import { journaliser } from "@/lib/audit";
import { transitionAutorisee, roleRequisPour } from "@/lib/paie-etats";
import { calculerLignesPaie } from "@/lib/paie-batch";
import type { ModePaiement, PaymentStatus } from "@prisma/client";

// États figés : une ligne validée ou payée n'est jamais recalculée / écrasée (bulletin émis).
const STATUTS_FIGES: PaymentStatus[] = ["VALIDE", "PAYE"];

export async function calculerPaieDuMois() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  const run = await prisma.payrollRun.upsert({
    where: { mois_annee: { mois, annee } },
    update: { tauxChangeUtilise: config.tauxChangeCDF },
    create: { mois, annee, tauxChangeUtilise: config.tauxChangeCDF },
  });

  // Lignes déjà validées/payées : on ne les recalcule pas (bulletin émis non écrasable).
  const lignesFigees = await prisma.payrollLine.findMany({
    where: { payrollRunId: run.id, statutPaiement: { in: STATUTS_FIGES } },
    select: { employeeId: true },
  });
  const employeeIdsFiges = new Set(lignesFigees.map((l) => l.employeeId));

  // Calcul en mémoire de tous les actifs (logique partagée avec l'aperçu temps réel de la page).
  const { lignes, employesFraisMedicaux: fraisTous } = await calculerLignesPaie(mois, annee);
  const nouvellesLignes = lignes
    .filter((l) => !employeeIdsFiges.has(l.employee.id))
    .map((l) => ({ payrollRunId: run.id, employeeId: l.employee.id, ...l.data }));
  // On ne remet à zéro le solde « frais médicaux » que des lignes réellement (ré)écrites.
  const employesFraisMedicaux = fraisTous.filter((id) => !employeeIdsFiges.has(id));

  // Écriture en masse dans une transaction (remplace ~100 requêtes par ~4).
  await prisma.$transaction([
    prisma.payrollLine.deleteMany({
      where: { payrollRunId: run.id, statutPaiement: { notIn: STATUTS_FIGES } },
    }),
    prisma.payrollLine.createMany({ data: nouvellesLignes }),
    prisma.employee.updateMany({
      where: { id: { in: employesFraisMedicaux } },
      data: { fraisMedicauxMoisCourant: 0 },
    }),
    prisma.journalAudit.create({
      data: {
        entite: "PayrollRun",
        entiteId: run.id,
        champ: "calcul",
        nouvelleValeur: `${nouvellesLignes.length} salaire(s) recalculé(s) — ${mois}/${annee}`,
        userId: user.id,
      },
    }),
  ]);

  revalidatePath("/paie");
  revalidatePath("/dashboard");
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
 * (en lot : on ignore silencieusement les lignes non concernées). NE vérifie pas le rôle ni ne
 * revalide — l'appelant s'en charge (unitaire ou groupé).
 */
async function appliquerTransitionPaie(
  payrollLineId: string,
  versStatut: PaymentStatus,
  opts: { modePaiement?: ModePaiement | null; preuveUrl?: string | null; commentaire?: string | null },
  userId: string
): Promise<boolean> {
  const ligne = await prisma.payrollLine.findUnique({
    where: { id: payrollLineId },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne || !transitionAutorisee(ligne.statutPaiement, versStatut)) return false;

  const deStatut = ligne.statutPaiement;
  // Moyen de paiement : celui explicitement choisi, sinon celui configuré sur la fiche employé
  // (virement si banque renseignée, mobile money si mobile renseigné, sinon espèces) — plus jamais
  // « espèces » imposé par défaut, y compris pour les actions groupées.
  const modePaiement =
    opts.modePaiement ??
    (ligne.employee.banque ? "VIREMENT" : ligne.employee.mobileMoney ? "MOBILE_MONEY" : "ESPECES");

  await prisma.$transaction(async (tx) => {
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

  const ok = await appliquerTransitionPaie(
    payrollLineId,
    versStatut,
    { modePaiement, preuveUrl, commentaire },
    user.id
  );
  if (!ok) throw new Error(`Transition non autorisée vers ${versStatut}.`);

  revalidatePath("/paie");
  revalidatePath("/dashboard");
  revalidatePath("/a-valider");
}

/**
 * ACTION GROUPÉE : applique la même transition à plusieurs lignes d'un coup (gain de temps).
 * Les lignes pour lesquelles la transition n'est pas autorisée sont ignorées. Retourne le
 * nombre de lignes effectivement modifiées.
 */
export async function changerStatutEnLot(
  payrollLineIds: string[],
  versStatut: PaymentStatus,
  modePaiement?: ModePaiement | null
): Promise<number> {
  const user = await verifySession();
  requireRole(user, roleRequisPour(versStatut));

  let modifiees = 0;
  for (const id of payrollLineIds) {
    if (await appliquerTransitionPaie(id, versStatut, { modePaiement }, user.id)) modifiees++;
  }

  revalidatePath("/paie");
  revalidatePath("/dashboard");
  revalidatePath("/a-valider");
  return modifiees;
}

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
    throw new Error(
      `Clôture bloquée : ${taches.length} tâche(s) à traiter avant de valider la paie (voir la bannière).`
    );
  }

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
    include: { lignes: { where: { statutPaiement: "PAS_VALIDE" }, select: { id: true } } },
  });
  if (!run) return;

  for (const l of run.lignes) {
    await appliquerTransitionPaie(l.id, "VALIDE", {}, user.id);
  }
  await prisma.payrollRun.update({ where: { id: run.id }, data: { statut: "VALIDE" } });

  revalidatePath("/paie");
  revalidatePath("/a-valider");
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
  revalidatePath("/historique");
  redirect(`/paie?msg=${encodeURIComponent("Paie du mois réinitialisée.")}`);
}
