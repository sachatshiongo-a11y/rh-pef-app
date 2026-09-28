import "server-only";

import type { Prisma } from "@prisma/client";
import { chargerParametresPaie } from "@/lib/config";
import { ancienneteEnMois, calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { typeSansConges } from "@/lib/regles-contrats";

/**
 * LE SOLDE DE CONGÉ DE L'ESPACE SALARIÉ — UNE SEULE SOURCE (lot 6, 2026-09-28).
 *
 * Avant, l'Accueil et « Mes congés » le calculaient chacun de leur côté, et pas de la même façon :
 * - l'ancienneté : l'Accueil comptait les mois RÉVOLUS (`ancienneteEnMois`, règle de la paie),
 *   « Mes congés » comptait le mois entamé → un salarié embauché le 20 voyait, jusqu'au 19 du mois
 *   suivant, 1,5 jour de plus sur « Mes congés » que sur l'Accueil ;
 * - les types décomptés : « Mes congés » ne connaissait que les types ACTIFS → un congé approuvé
 *   d'un type retiré depuis cessait d'entamer le solde sur cet écran-là seulement ;
 * - les demandes lues : « Mes congés » partait des 60 dernières, l'Accueil de toutes.
 * Deux écrans, deux chiffres : le salarié ne pouvait pas savoir lequel croire. Les deux lisent
 * désormais ceci, qui applique la règle de l'Accueil (celle de la fiche RH et du PDF de demande).
 */
export type SoldeConge = {
  /** Droits acquis à ce jour (0 pour un stage ou un intérim). */
  acquis: number;
  /** Jours approuvés depuis le 1er janvier, des seuls types qui entament le solde. */
  pris: number;
  /** acquis − pris, au dixième. */
  solde: number;
  /** Noms des types actifs qui entament le solde — pour le dire au salarié. */
  typesDeduits: string[];
};

/** Le calcul, sans base : testable tel quel. */
export function calculerSoldeConge(p: {
  acquis: number;
  demandesApprouvees: { type: string; nbJours: number; dateDebut: Date }[];
  compteDansSolde: Map<string, boolean>;
  debutAnnee: Date;
}): { acquis: number; pris: number; solde: number } {
  const pris = p.demandesApprouvees
    .filter((l) => new Date(l.dateDebut) >= p.debutAnnee && congeDeductibleDuSolde(p.compteDansSolde.get(l.type)))
    .reduce((a, l) => a + l.nbJours, 0);
  return { acquis: p.acquis, pris, solde: Math.round((p.acquis - pris) * 10) / 10 };
}

export async function chargerSoldeCongeSalarie(
  db: Prisma.TransactionClient,
  employeeId: string,
  maintenant: Date = new Date(),
): Promise<SoldeConge> {
  const debutAnnee = new Date(Date.UTC(maintenant.getUTCFullYear(), 0, 1));
  const [emp, params, types, approuvees] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { contrat: true, dateEmbauche: true } }),
    chargerParametresPaie(db),
    // TOUS les types (actifs ou non) : un congé approuvé garde son effet si le type est retiré ensuite.
    db.typeConge.findMany({ orderBy: { ordre: "asc" }, select: { nom: true, compteDansSolde: true, actif: true } }),
    db.leaveRequest.findMany({
      where: { employeeId, statut: "APPROUVE", dateDebut: { gte: debutAnnee } },
      select: { type: true, nbJours: true, dateDebut: true },
    }),
  ]);
  const acquis = typeSansConges(emp.contrat)
    ? 0
    : calculerCongesAcquis(ancienneteEnMois(new Date(emp.dateEmbauche), maintenant), params.droitsCongesAnnuel);
  const r = calculerSoldeConge({
    acquis,
    demandesApprouvees: approuvees.map((l) => ({ type: l.type, nbJours: Number(l.nbJours), dateDebut: l.dateDebut })),
    compteDansSolde: new Map(types.map((t) => [t.nom, t.compteDansSolde])),
    debutAnnee,
  });
  return { ...r, typesDeduits: types.filter((t) => t.actif && t.compteDansSolde).map((t) => t.nom) };
}
