import "server-only";
import type { Prisma } from "@prisma/client";

// HISTORIQUE DES RAPPORTS GÉNÉRÉS (Archives › Rapports) — audit du 10/10/2026, stock 20. La ligne d'historique
// ne s'écrit qu'APRÈS un rendu réussi (un rapport qui échoue n'a rien produit : il n'a pas à figurer parmi les
// rapports générés) et UNE FOIS pour une même demande répétée de suite (rechargement, nouvel essai du
// navigateur, double clic) : même compte, mêmes paramètres, dans la fenêtre ci-dessous.

export const FENETRE_REPETITION_RAPPORT_MS = 2 * 60_000;

export type RapportGenere = { titre: string; type: string; mode: string; format: string; periodeDebut: Date; periodeFin: Date; creeParId: string };

/** Écrit la ligne d'historique sauf si la même demande vient d'être journalisée. Rend vrai si une ligne a été écrite. */
export async function journaliserRapportGenere(db: Pick<Prisma.TransactionClient, "rapport">, r: RapportGenere, maintenant: Date = new Date()): Promise<boolean> {
  const recente = await db.rapport.findFirst({
    where: { type: r.type, mode: r.mode, format: r.format, periodeDebut: r.periodeDebut, periodeFin: r.periodeFin, creeParId: r.creeParId, createdAt: { gte: new Date(maintenant.getTime() - FENETRE_REPETITION_RAPPORT_MS) } },
    select: { id: true },
  });
  if (recente) return false;
  await db.rapport.create({ data: r });
  return true;
}
