import "server-only";
import { prisma } from "@/lib/prisma";

// Garde-fous légaux du cycle de vie des contrats (CDD, période d'essai). Les valeurs vivent
// dans les Paramètres légaux (Barèmes), statut « À VALIDER » — modifiables sans redéploiement ;
// à défaut, des valeurs par défaut prudentes s'appliquent (à faire valider par un juriste).

export type ReglesContrats = {
  cddRenouvellementsMax: number;
  cddDureeTotaleMaxMois: number;
  essaiDureeMaxMois: number;
};

export const REGLES_DEFAUT: ReglesContrats = {
  cddRenouvellementsMax: 2,
  cddDureeTotaleMaxMois: 24,
  essaiDureeMaxMois: 6,
};

/** Règles courantes : Paramètres légaux du dernier exercice, sinon défauts prudents. */
export async function chargerReglesContrats(): Promise<ReglesContrats> {
  const rows = await prisma.parametreLegal.findMany({
    where: { cle: { in: ["cdd_renouvellements_max", "cdd_duree_totale_max_mois", "essai_duree_max_mois"] } },
    orderBy: { exerciceId: "desc" },
  });
  const val = (cle: string) => {
    const r = rows.find((x) => x.cle === cle && x.valeur !== null);
    return r ? Number(r.valeur) : null;
  };
  return {
    cddRenouvellementsMax: val("cdd_renouvellements_max") ?? REGLES_DEFAUT.cddRenouvellementsMax,
    cddDureeTotaleMaxMois: val("cdd_duree_totale_max_mois") ?? REGLES_DEFAUT.cddDureeTotaleMaxMois,
    essaiDureeMaxMois: val("essai_duree_max_mois") ?? REGLES_DEFAUT.essaiDureeMaxMois,
  };
}

/** Mois (fractionnaires) entre deux dates — pour comparer aux durées maximales. */
export function moisEntre(debut: Date, fin: Date): number {
  return (fin.getTime() - debut.getTime()) / (30.44 * 86_400_000);
}

/**
 * Vérifie une prolongation de CDD. Renvoie le message d'erreur lisible, ou null si permise.
 * `renouvellements` = nombre de prolongations DÉJÀ effectuées sur ce contrat.
 */
export function verifierProlongationCdd(
  contrat: { dateDebut: Date; dateFin: Date | null; renouvellements: number },
  nouvelleFin: Date,
  regles: ReglesContrats
): string | null {
  if (contrat.dateFin && nouvelleFin <= new Date(contrat.dateFin)) {
    return "La nouvelle date de fin doit être postérieure à la date de fin actuelle.";
  }
  if (contrat.renouvellements + 1 > regles.cddRenouvellementsMax) {
    return `Ce CDD a déjà été prolongé ${contrat.renouvellements} fois (maximum : ${regles.cddRenouvellementsMax}, Code du travail — paramètre modifiable dans les Barèmes). Transformez-le en CDI ou laissez-le s'achever.`;
  }
  const dureeMois = moisEntre(new Date(contrat.dateDebut), nouvelleFin);
  if (dureeMois > regles.cddDureeTotaleMaxMois) {
    return `Cette prolongation porterait le CDD à ${Math.round(dureeMois)} mois au total (maximum : ${regles.cddDureeTotaleMaxMois} mois, Code du travail — paramètre modifiable dans les Barèmes). Transformez-le en CDI.`;
  }
  return null;
}

/** Vérifie une prolongation de période d'essai. Message d'erreur lisible, ou null si permise. */
export function verifierProlongationEssai(
  contrat: { dateDebut: Date; finPeriodeEssai: Date | null },
  nouvelleFinEssai: Date,
  regles: ReglesContrats
): string | null {
  if (contrat.finPeriodeEssai && nouvelleFinEssai <= new Date(contrat.finPeriodeEssai)) {
    return "La nouvelle fin d'essai doit être postérieure à la fin d'essai actuelle.";
  }
  const dureeMois = moisEntre(new Date(contrat.dateDebut), nouvelleFinEssai);
  if (dureeMois > regles.essaiDureeMaxMois) {
    return `La période d'essai atteindrait ${Math.round(dureeMois * 10) / 10} mois depuis le début du contrat (maximum : ${regles.essaiDureeMaxMois} mois, Code du travail — paramètre modifiable dans les Barèmes).`;
  }
  return null;
}

/** Un contrat de ce type n'acquiert pas de congés payés (stage, intérim). */
export function typeSansConges(type: string | null | undefined): boolean {
  return type === "STAGE" || type === "INTERIM";
}
