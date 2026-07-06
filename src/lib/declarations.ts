import "server-only";

import { prisma } from "@/lib/prisma";
import type { StatutDeclaration, TypeTaxe } from "@prisma/client";

export type LigneDeclaration = {
  type: TypeTaxe;
  libelle: string;
  detail: string;
  montantUSD: number;
  montantCDF: number;
  echeance: Date;
  echeanceAValider: boolean; // délai non confirmé par un comptable
  statut: StatutDeclaration;
};

const LIBELLES: Record<TypeTaxe, { libelle: string; detail: string; echeanceAValider: boolean }> = {
  CNSS: {
    libelle: "CNSS",
    detail: "Part salariale (5%) + part patronale (13%) — à déclarer avant le 15 du mois suivant",
    echeanceAValider: false,
  },
  IPR: {
    libelle: "IPR",
    detail: "Impôt professionnel sur les rémunérations retenu à la source — délai À VALIDER",
    echeanceAValider: true,
  },
  INPP: {
    libelle: "INPP",
    detail: "Cotisation patronale formation professionnelle — délai À VALIDER",
    echeanceAValider: true,
  },
  ONEM: {
    libelle: "ONEM",
    detail: "Cotisation patronale Office National de l'Emploi — délai À VALIDER",
    echeanceAValider: true,
  },
};

/**
 * Calcule le bordereau des déclarations d'un mois de paie : montants agrégés depuis les
 * lignes de paie, échéance au 15 du mois SUIVANT (CNSS confirmé ; autres À VALIDER),
 * et statut de suivi (A_DECLARER tant que le directeur ne l'a pas marqué).
 * Retourne null si aucune paie n'est calculée pour ce mois.
 */
export async function calculerDeclarationsMois(
  mois: number,
  annee: number
): Promise<{ lignes: LigneDeclaration[]; tauxChange: number } | null> {
  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: true },
  });
  if (!run || run.lignes.length === 0) return null;

  const lignesRun = run.lignes;
  const somme = (f: (l: (typeof lignesRun)[number]) => number) =>
    lignesRun.reduce((acc, l) => acc + f(l), 0);

  const tauxChange = Number(run.tauxChangeUtilise);
  const montants: Record<TypeTaxe, number> = {
    CNSS: somme((l) => Number(l.cnssSalarieUSD) + Number(l.cnssPatronalUSD)),
    IPR: somme((l) => Number(l.iprCalculeUSD)),
    INPP: somme((l) => Number(l.inppUSD)),
    ONEM: somme((l) => Number(l.onemUSD)),
  };

  // Échéance : le 15 du mois suivant la période de paie.
  const echeance = new Date(Date.UTC(mois === 12 ? annee + 1 : annee, mois === 12 ? 0 : mois, 15));

  const suivis = await prisma.declarationTaxe.findMany({ where: { mois, annee } });
  const statutDe = (type: TypeTaxe): StatutDeclaration =>
    suivis.find((s) => s.type === type)?.statut ?? "A_DECLARER";

  const lignes: LigneDeclaration[] = (Object.keys(montants) as TypeTaxe[]).map((type) => ({
    type,
    libelle: LIBELLES[type].libelle,
    detail: LIBELLES[type].detail,
    montantUSD: montants[type],
    montantCDF: montants[type] * tauxChange,
    echeance,
    echeanceAValider: LIBELLES[type].echeanceAValider,
    statut: statutDe(type),
  }));

  return { lignes, tauxChange };
}
