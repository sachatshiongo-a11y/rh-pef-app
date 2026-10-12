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

/**
 * PREMIÈRE ligne de l'historique salarial d'une fiche qui vient d'être créée : « Salaire d'embauche »,
 * à la date d'embauche, sans ancien salaire. Même table que `enregistrerChangementSalaire` ; la fiche porte
 * déjà ce salaire (aucune écriture sur `Employee`). Dans la transaction de la création.
 */
export async function enregistrerSalaireEmbauche(
  tx: Prisma.TransactionClient,
  p: { employeeId: string; salaire: { toString(): string } | number; poste: string; dateEmbauche: Date; userId: string },
): Promise<void> {
  await tx.historiqueSalaire.create({
    data: {
      employeeId: p.employeeId,
      date: p.dateEmbauche,
      ancienSalaire: null,
      nouveauSalaire: Number(p.salaire),
      ancienPoste: null,
      nouveauPoste: p.poste,
      motif: "Salaire d'embauche",
      decideParId: p.userId,
    },
  });
  await journaliser(tx, {
    entite: "Employee",
    entiteId: p.employeeId,
    champ: "salaireMensuel",
    nouvelleValeur: `${Number(p.salaire)} (salaire d'embauche)`,
    userId: p.userId,
  });
}
