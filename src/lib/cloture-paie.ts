import "server-only";

import { prisma } from "@/lib/prisma";

export type TacheBloquante = {
  type: "ACOMPTE" | "CONTRAT" | "PERIODE_ESSAI" | "JOUR_P_SANS_HEURES";
  employeeId: string;
  nom: string;
  detail: string;
};

/**
 * Tâches qui BLOQUENT la clôture globale de la paie du mois (§9) :
 * - demande d'acompte non traitée (à approuver/refuser) ;
 * - contrat arrivant à échéance dans le mois (à prolonger/transformer/rompre) ;
 * - période d'essai se terminant dans le mois (à transformer en CDI/CDD ou rompre) ;
 * - jour codé « Présent » (P) SANS heures saisies (à corriger dans Présences/Heures supp.).
 * Se résolvent via les Demandes de validation (acompte), le Dossier employé (contrats) et la
 * grille Présences & heures.
 */
export async function tachesBloquantesCloture(mois: number, annee: number): Promise<TacheBloquante[]> {
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [acomptes, contrats, presencesP, heuresDuMois] = await Promise.all([
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
    prisma.attendance.findMany({
      where: { code: "P", date: { gte: debutMois, lte: finMois } },
      include: { employee: { select: { id: true, nom: true } } },
    }),
    prisma.overtimeEntry.findMany({
      where: { date: { gte: debutMois, lte: finMois } },
      select: { employeeId: true, date: true, heuresTravaillees: true },
    }),
  ]);

  const taches: TacheBloquante[] = [];

  // Jour « P » (Présent) SANS heures saisies (bug #5) : ni O/A/C/F/M (jours payés/maladie), ni
  // heures travaillées → salaire 0 $ SILENCIEUX pour ce jour dans le calcul de paie (paie-batch.ts,
  // bulletin-live.ts). On ne change PAS la règle de paie (décision produit non prise) : on bloque
  // la clôture pour forcer une correction EXPLICITE (ressaisir les heures, ou changer le code du
  // jour) plutôt que de laisser passer un jour non payé sans que personne ne s'en aperçoive.
  // Se produit typiquement si les heures d'un jour « P » sont effacées après coup (heures-supp
  // actions.ts) — le flux normal de pose du « P » pré-remplit pourtant les heures.
  const heuresPositives = new Set(
    heuresDuMois
      .filter((h) => Number(h.heuresTravaillees) > 0)
      .map((h) => `${h.employeeId}|${new Date(h.date).toISOString().slice(0, 10)}`)
  );
  const joursPSansHeuresParEmp = new Map<string, { nom: string; dates: string[] }>();
  for (const a of presencesP) {
    const iso = new Date(a.date).toISOString().slice(0, 10);
    if (heuresPositives.has(`${a.employeeId}|${iso}`)) continue;
    const entree = joursPSansHeuresParEmp.get(a.employeeId) ?? { nom: a.employee.nom, dates: [] };
    entree.dates.push(iso);
    joursPSansHeuresParEmp.set(a.employeeId, entree);
  }
  for (const [employeeId, { nom, dates }] of joursPSansHeuresParEmp) {
    const datesTriees = [...dates].sort();
    const datesAffichees = datesTriees
      .slice(0, 5)
      .map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" }))
      .join(", ");
    taches.push({
      type: "JOUR_P_SANS_HEURES",
      employeeId,
      nom,
      detail: `${dates.length} jour(s) « Présent » sans heures saisies (${datesAffichees}${dates.length > 5 ? "…" : ""}) — non payé(s) si non corrigé`,
    });
  }

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
