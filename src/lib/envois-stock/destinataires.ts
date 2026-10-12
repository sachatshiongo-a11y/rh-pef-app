import "server-only";

import { prisma } from "@/lib/prisma";

// DESTINATAIRES DES COURRIELS AUTOMATIQUES DU STOCK (2026-10-12).
//
// Les comptes qui ont le Stock en propre : la Direction (ADMIN) et le rôle STOCK, actifs — exactement les cibles des
// alertes de stock bas (`lib/alerte-stock.ts`). Les rappels RH vont, eux, aux seuls ADMIN (`app/api/cron/alertes`) :
// un compte RH (MANAGER, VIEWER) ne reçoit RIEN du Stock, et un compte STOCK ne reçoit rien du RH.
//
// Un salarié à qui l'accès Stock a été accordé (EMPLOYE + accesStock) n'est PAS destinataire : ses écrans Stock
// sont restreints, et ces courriels portent des montants (factures, valeur du stock, achats par fournisseur).

/** Les rôles destinataires. Une liste fermée, vérifiée par le test des destinataires. */
export const ROLES_DESTINATAIRES_STOCK = ["ADMIN", "STOCK"] as const;

export type DestinataireStock = { id: string; email: string; role: string };

export async function destinatairesStock(): Promise<DestinataireStock[]> {
  const comptes = await prisma.user.findMany({
    where: { role: { in: [...ROLES_DESTINATAIRES_STOCK] }, actif: true },
    select: { id: true, email: true, role: true },
    orderBy: { email: "asc" },
  });
  return comptes.filter((c) => c.email.trim() !== "");
}
