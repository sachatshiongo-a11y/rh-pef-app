import type { PaymentStatus, PrismaClient } from "@prisma/client";

/**
 * CE QUE LE SALARIÉ VOIT DE SA PAIE : les bulletins VALIDÉS ou PAYÉS, jamais un brouillon.
 *
 * Un bulletin PAS_VALIDE est recalculé à chaque saisie de présence : ses montants bougent, la
 * Direction ne les a pas encore arrêtés. Jusqu'au 2026-09-28, « Ma paie » proposait pourtant le
 * PDF de la période quel que soit son statut, et la route `/espace/bulletin/[id]` le servait — le
 * salarié lisait un montant que personne n'avait validé. « Mes documents » filtrait déjà ; la règle
 * vit désormais ici, une seule fois, pour les trois endroits.
 */
export const STATUTS_BULLETIN_SALARIE = ["VALIDE", "PAYE"] as const satisfies readonly PaymentStatus[];

export function bulletinVisibleParLeSalarie(statut: PaymentStatus): boolean {
  return (STATUTS_BULLETIN_SALARIE as readonly PaymentStatus[]).includes(statut);
}

/** Bulletin de la période que « Ma paie » peut proposer au salarié, ou null (pas calculé, ou brouillon). */
export async function bulletinConsultableDuMois(
  db: PrismaClient,
  employeeId: string,
  mois: number,
  annee: number,
): Promise<{ id: string; statutPaiement: PaymentStatus } | null> {
  return db.payrollLine.findFirst({
    where: { employeeId, payrollRun: { mois, annee }, statutPaiement: { in: [...STATUTS_BULLETIN_SALARIE] } },
    select: { id: true, statutPaiement: true },
  });
}
