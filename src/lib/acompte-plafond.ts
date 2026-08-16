// Plafond d'acompte sur salaire — fonction PURE (aucune I/O, uniquement des nombres en
// entrée/sortie), même convention que src/lib/payroll.ts et src/lib/prets.ts.
//
// Règle (décision 2026-08-16) : un acompte est une avance sur un droit DÉJÀ acquis, il ne peut
// donc pas dépasser ce que le salarié a effectivement touché le mois précédent. Sans bulletin le
// mois précédent (embauche récente), on retombe sur le salaire mensuel de la fiche employé —
// choix explicite du client, plus souple que la règle « pas de bulletin, pas d'acompte ».
//
// Le plafond porte sur le CUMUL du mois, pas sur une demande isolée : sans ça, trois demandes de
// 100 % passeraient une par une. Les demandes EN_ATTENTE comptent au même titre que les
// APPROUVÉES — sinon la Direction pourrait approuver un lot dont chaque ligne, prise seule,
// tenait dans le plafond.

// Pas de garde `server-only` ici, volontairement : le cœur de la règle doit rester testable
// unitairement sans base ni runtime Next. Le seul accès aux données (`chargerPlafondAcompte`, en
// bas de fichier) reçoit son client Prisma en PARAMÈTRE — même convention que `journaliser`.

import type { Prisma } from "@prisma/client";
import { formaterUSD } from "@/lib/montant";

/** D'où vient le plafond retenu — repris tel quel dans les messages affichés à l'utilisateur. */
export type SourcePlafond = "NET_MOIS_PRECEDENT" | "SALAIRE_FICHE";

export type PlafondAcompte = {
  plafondUSD: number;
  source: SourcePlafond;
  /** Somme des acomptes du mois déjà demandés ou approuvés (hors celui qu'on est en train d'examiner). */
  dejaEngageUSD: number;
  /** Ce qu'il reste réellement disponible : max(0, plafond − déjà engagé). */
  disponibleUSD: number;
};

/**
 * Tolérance d'arrondi (un demi-centime) : un montant saisi au centime ne doit pas être refusé
 * pour une poussière de flottant quand il vaut EXACTEMENT le disponible.
 */
const EPSILON_USD = 0.005;

export function calculerPlafondAcompte(entrees: {
  /** Net du bulletin du mois précédent, ou null si aucun bulletin (embauche récente, reprise). */
  netMoisPrecedentUSD: number | null;
  /** Salaire mensuel de la fiche employé — filet de sécurité quand il n'y a pas de bulletin. */
  salaireFicheUSD: number;
  /** Montants des acomptes du mois déjà EN_ATTENTE ou APPROUVÉS (hors celui examiné). */
  acomptesEngagesUSD: number[];
}): PlafondAcompte {
  // Un net négatif ou nul n'est pas une référence exploitable : on retombe sur la fiche.
  const netUtilisable =
    entrees.netMoisPrecedentUSD !== null && entrees.netMoisPrecedentUSD > 0
      ? entrees.netMoisPrecedentUSD
      : null;

  const source: SourcePlafond = netUtilisable !== null ? "NET_MOIS_PRECEDENT" : "SALAIRE_FICHE";
  const plafondUSD = Math.max(0, netUtilisable ?? entrees.salaireFicheUSD);
  const dejaEngageUSD = entrees.acomptesEngagesUSD.reduce((s, m) => s + m, 0);

  return {
    plafondUSD,
    source,
    dejaEngageUSD,
    disponibleUSD: Math.max(0, plafondUSD - dejaEngageUSD),
  };
}

/** Libellé de la référence utilisée, pour les messages et l'aide à la saisie. */
export function libelleSourcePlafond(source: SourcePlafond): string {
  return source === "NET_MOIS_PRECEDENT"
    ? "net du mois précédent"
    : "salaire de la fiche (aucun bulletin le mois précédent)";
}

export type VerdictAcompte = { ok: true } | { ok: false; message: string };

/**
 * Vérifie un montant demandé contre le plafond. Le message est ACTIONNABLE : il dit la référence,
 * ce qui est déjà engagé et ce qui reste — jamais un simple « montant trop élevé ».
 */
export function verifierMontantAcompte(montantUSD: number, plafond: PlafondAcompte): VerdictAcompte {
  if (!Number.isFinite(montantUSD) || montantUSD <= 0) {
    return { ok: false, message: "Indiquez un montant d'acompte valide (en $)." };
  }

  if (plafond.plafondUSD <= 0) {
    return {
      ok: false,
      message:
        "Aucun acompte possible : ni bulletin le mois précédent, ni salaire renseigné sur la fiche.",
    };
  }

  if (montantUSD > plafond.disponibleUSD + EPSILON_USD) {
    const reference = `${formaterUSD(plafond.plafondUSD)} (${libelleSourcePlafond(plafond.source)})`;
    const dejaEngage =
      plafond.dejaEngageUSD > 0
        ? ` ${formaterUSD(plafond.dejaEngageUSD)} déjà engagé ce mois, il reste ${formaterUSD(plafond.disponibleUSD)}.`
        : "";
    return {
      ok: false,
      message: `Acompte plafonné à ${reference}.${dejaEngage}`,
    };
  }

  return { ok: true };
}

/** Résultat d'une décision unitaire (approbation/refus) — même forme que `VerdictAcompte`.
 * Déclaré ICI et non dans le fichier d'actions : un module « use server » ne peut exporter que des
 * fonctions asynchrones. */
export type DecisionAcompte = VerdictAcompte;

/** Résultat d'une décision en lot : ce qui est passé, ce qui a été bloqué, et pourquoi. */
export type ResultatLotAcomptes = {
  traites: number;
  bloques: number;
  /** Message du premier acompte bloqué — suffit à expliquer le cas à l'écran. */
  message?: string;
};

/** Mois précédent d'une période de paie (janvier → décembre de l'année d'avant). */
export function moisPrecedent(mois: number, annee: number): { mois: number; annee: number } {
  return mois === 1 ? { mois: 12, annee: annee - 1 } : { mois: mois - 1, annee };
}

type ClientLecture = Prisma.TransactionClient;

/**
 * Rassemble les trois entrées de la règle depuis la base : net du bulletin M-1, salaire de la
 * fiche, et acomptes du mois déjà engagés. `exclureAcompteId` sert au ré-examen à l'approbation :
 * l'acompte qu'on est en train de décider ne doit pas se compter lui-même comme « déjà engagé ».
 */
export async function chargerPlafondAcompte(
  client: ClientLecture,
  params: { employeeId: string; mois: number; annee: number; exclureAcompteId?: string }
): Promise<PlafondAcompte> {
  const precedent = moisPrecedent(params.mois, params.annee);

  const [employe, lignePrecedente, engages] = await Promise.all([
    client.employee.findUnique({
      where: { id: params.employeeId },
      select: { salaireMensuel: true },
    }),
    client.payrollLine.findFirst({
      where: {
        employeeId: params.employeeId,
        payrollRun: { mois: precedent.mois, annee: precedent.annee },
      },
      select: { salNetUSD: true },
    }),
    client.acompteSalaire.findMany({
      where: {
        employeeId: params.employeeId,
        mois: params.mois,
        annee: params.annee,
        statut: { in: ["EN_ATTENTE", "APPROUVE"] },
        ...(params.exclureAcompteId ? { id: { not: params.exclureAcompteId } } : {}),
      },
      select: { montantUSD: true },
    }),
  ]);

  return calculerPlafondAcompte({
    netMoisPrecedentUSD: lignePrecedente ? Number(lignePrecedente.salNetUSD) : null,
    salaireFicheUSD: employe ? Number(employe.salaireMensuel) : 0,
    acomptesEngagesUSD: engages.map((a) => Number(a.montantUSD)),
  });
}
