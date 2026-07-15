import "server-only";

import { prisma } from "@/lib/prisma";

export type TacheBloquante = {
  type: "ACOMPTE" | "CONTRAT" | "PERIODE_ESSAI";
  employeeId: string;
  nom: string;
  detail: string;
};

/**
 * Tâches qui BLOQUENT la clôture globale de la paie du mois (§9) :
 * - demande d'acompte non traitée (à approuver/refuser) ;
 * - contrat arrivant à échéance dans le mois (à prolonger/transformer/rompre) ;
 * - période d'essai se terminant dans le mois (à transformer en CDI/CDD ou rompre).
 * Se résolvent via les Demandes de validation (acompte) et le Dossier employé (contrats).
 */
export async function tachesBloquantesCloture(mois: number, annee: number): Promise<TacheBloquante[]> {
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [acomptes, contrats] = await Promise.all([
    prisma.acompteSalaire.findMany({
      where: { statut: "EN_ATTENTE", mois, annee },
      include: { employee: { select: { id: true, nom: true } } },
    }),
    prisma.contrat.findMany({
      where: {
        statut: "ACTIF",
        OR: [
          { dateFin: { gte: debutMois, lte: finMois } },
          { finPeriodeEssai: { gte: debutMois, lte: finMois } },
        ],
      },
      include: { employee: { select: { id: true, nom: true } } },
    }),
  ]);

  const taches: TacheBloquante[] = [];
  for (const a of acomptes)
    taches.push({
      type: "ACOMPTE",
      employeeId: a.employee.id,
      nom: a.employee.nom,
      detail: `Acompte de ${Number(a.montantUSD)} $ à traiter`,
    });
  for (const c of contrats) {
    if (c.dateFin && c.dateFin >= debutMois && c.dateFin <= finMois)
      taches.push({
        type: "CONTRAT",
        employeeId: c.employee.id,
        nom: c.employee.nom,
        detail:
          c.type === "STAGE"
            ? `Fin de stage le ${new Date(c.dateFin).toLocaleDateString("fr-FR")}`
            : c.type === "INTERIM"
            ? `Fin de mission d'intérim le ${new Date(c.dateFin).toLocaleDateString("fr-FR")}`
            : `Contrat ${c.type} arrive à échéance le ${new Date(c.dateFin).toLocaleDateString("fr-FR")}`,
      });
    if (c.finPeriodeEssai && c.finPeriodeEssai >= debutMois && c.finPeriodeEssai <= finMois)
      taches.push({
        type: "PERIODE_ESSAI",
        employeeId: c.employee.id,
        nom: c.employee.nom,
        detail: `Fin de période d'essai le ${new Date(c.finPeriodeEssai).toLocaleDateString("fr-FR")}`,
      });
  }
  return taches;
}
