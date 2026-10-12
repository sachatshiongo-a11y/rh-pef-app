import "server-only";

import type { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MOIS_FR } from "@/lib/dates-fr";
import { ATTENTE_VERROU_VALIDATION, messageErreurValidation } from "@/lib/paie-validation";
import { ErreurMetier } from "@/lib/erreur-metier";

// ÉLÉMENT DE PAIE SUR UN BULLETIN DÉJÀ FIGÉ (audit du 2026-10-10).
//
// Prime, acompte, frais médical et avantage en nature sont rattachés à un MOIS. Le recalcul ne
// touche jamais une ligne VALIDÉE ou PAYÉE (STATUTS_FIGES, paie-refresh.ts) : un élément ajouté (ou
// un acompte approuvé, ou un élément retiré) pour un mois dont le bulletin du salarié est déjà figé
// ne figurait donc sur AUCUN bulletin — ni celui du mois, figé, ni le suivant, qui ne lit que son
// propre mois. Le geste est refusé, avec la sortie : rouvrir le bulletin, ou passer par le mois
// suivant. L'outil ne déplace rien tout seul : la Direction choisit.

export function messageBulletinFige(statut: PaymentStatus, mois: number, annee: number): string {
  return `Le bulletin de ${MOIS_FR[mois - 1]} ${annee} est déjà ${statut === "PAYE" ? "payé" : "validé"} : rouvrez-le, ou saisissez l'élément sur le mois suivant.`;
}

/** Refus lisible : le bulletin du mois est figé. */
export class BulletinFigeError extends ErreurMetier {
  constructor(message: string) {
    super(message);
    this.name = "BulletinFigeError";
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Refuse (`BulletinFigeError`) si la ligne de paie du salarié pour `mois`/`annee` est VALIDÉE ou PAYÉE.
 * Dans une transaction, la ligne est prise FOR SHARE (attente bornée) : une validation en cours de ce
 * bulletin se termine d'abord (et l'on refuse), ou attend la fin de l'ajout (et son contrôle du montant
 * voit l'élément, la ligne ayant changé : validation refusée, rien de perdu). Sans ligne (paie pas
 * encore calculée), rien à refuser.
 */
export async function exigerBulletinModifiable(db: Db, p: { employeeId: string; mois: number; annee: number }): Promise<void> {
  let lignes: { statutPaiement: PaymentStatus }[];
  try {
    if (db !== prisma) await db.$executeRawUnsafe(`SET LOCAL lock_timeout = '${ATTENTE_VERROU_VALIDATION}'`);
    lignes = await db.$queryRaw<{ statutPaiement: PaymentStatus }[]>`
      SELECT l."statutPaiement" FROM "public"."PayrollLine" l
      JOIN "public"."PayrollRun" r ON r."id" = l."payrollRunId"
      WHERE l."employeeId" = ${p.employeeId} AND r."mois" = ${p.mois} AND r."annee" = ${p.annee}
      FOR SHARE OF l`;
  } catch (e) {
    const occupe = messageErreurValidation(e);
    if (occupe) throw new BulletinFigeError("La paie de ce salarié est en cours de validation : réessayez dans un instant.");
    throw e;
  }
  const statut = lignes[0]?.statutPaiement;
  if (statut === "VALIDE" || statut === "PAYE") throw new BulletinFigeError(messageBulletinFige(statut, p.mois, p.annee));
}
