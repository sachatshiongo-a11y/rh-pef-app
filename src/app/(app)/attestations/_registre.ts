import "server-only";

import type { Prisma, StatutAttestation, TypeAttestation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jourKinshasa } from "@/lib/heure-kinshasa";
import { LIBELLE_STATUT_ATTESTATION, LIBELLE_TYPE_ATTESTATION, estTypeAttestation, estLibreService } from "@/lib/attestations-donnees";

// REGISTRE DES ATTESTATIONS — une seule lecture pour l'onglet « Attestations » de /documents et
// son export Excel : le fichier contient exactement ce que l'écran montre (mêmes filtres).

export type FiltresRegistre = { type: TypeAttestation | null; statut: StatutAttestation | null };

export function filtresRegistre(sp: { get(k: string): string | null }): FiltresRegistre {
  const type = sp.get("type");
  const statut = sp.get("statut");
  return {
    type: estTypeAttestation(type) ? type : null,
    statut: statut === "DEMANDEE" || statut === "DELIVREE" || statut === "REFUSEE" ? statut : null,
  };
}

export async function chargerRegistre(f: FiltresRegistre, employeeId?: string) {
  const where: Prisma.AttestationWhereInput = {
    ...(f.type ? { type: f.type } : {}),
    ...(f.statut ? { statut: f.statut } : {}),
    ...(employeeId ? { employeeId } : {}),
  };
  return prisma.attestation.findMany({
    where,
    include: {
      employee: { select: { id: true, nom: true, matricule: true, photoUrl: true } },
      delivreePar: { select: { nom: true } },
      demandePar: { select: { nom: true } },
    },
    orderBy: [{ delivreeLe: { sort: "desc", nulls: "last" } }, { demandeLe: "desc" }],
    take: 2000,
  });
}

export type LigneRegistre = Awaited<ReturnType<typeof chargerRegistre>>[number];

export const ENTETE_REGISTRE = ["Numéro", "Type", "Statut", "Matricule", "Employé", "Demandée le", "Délivrée ou refusée le", "Par", "Motif du refus"];

export function ligneRegistre(a: LigneRegistre): string[] {
  return [
    a.numero ?? "—",
    LIBELLE_TYPE_ATTESTATION[a.type],
    LIBELLE_STATUT_ATTESTATION[a.statut],
    a.employee.matricule,
    a.employee.nom,
    jourKinshasa(a.demandeLe),
    a.statut === "DEMANDEE" ? "—" : jourKinshasa(a.delivreeLe ?? a.updatedAt),
    estLibreService(a.donnees)
      ? `Libre-service (${a.employee.nom})`
      : a.delivreePar?.nom ?? (a.statut === "DEMANDEE" ? "—" : "compte supprimé"),
    a.motifRefus ?? "",
  ];
}
