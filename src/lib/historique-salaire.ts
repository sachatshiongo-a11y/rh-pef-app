import "server-only";

import type { Prisma } from "@prisma/client";
import { journaliser } from "@/lib/audit";

/**
 * LE chemin d'un changement de salaire (et de poste) — historique salarial + fiche + journal d'audit,
 * dans la transaction de l'appelant. Partagé par « Changer le salaire » (fiche) et « Modifier »
 * (Direction) : avant l'audit RH du 2026-10-10, « Modifier » réécrivait le salaire sans historique
 * ni trace.
 */
export async function enregistrerChangementSalaire(
  tx: Prisma.TransactionClient,
  p: {
    employeeId: string;
    ancienSalaire: { toString(): string } | number;
    nouveauSalaire: number;
    ancienPoste: string;
    nouveauPoste: string;
    motif: string;
    userId: string;
  },
): Promise<void> {
  await tx.historiqueSalaire.create({
    data: {
      employeeId: p.employeeId,
      ancienSalaire: Number(p.ancienSalaire),
      nouveauSalaire: p.nouveauSalaire,
      ancienPoste: p.ancienPoste,
      nouveauPoste: p.nouveauPoste,
      motif: p.motif,
      decideParId: p.userId,
    },
  });
  await tx.employee.update({ where: { id: p.employeeId }, data: { salaireMensuel: p.nouveauSalaire, poste: p.nouveauPoste } });
  await journaliser(tx, {
    entite: "Employee",
    entiteId: p.employeeId,
    champ: "salaireMensuel",
    ancienneValeur: p.ancienSalaire.toString(),
    nouvelleValeur: String(p.nouveauSalaire),
    userId: p.userId,
  });
}
