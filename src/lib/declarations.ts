import "server-only";

import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { formaterNombre } from "@/lib/montant";
import type { StatutDeclaration, TypeTaxe } from "@prisma/client";

/** Écart (en $) à partir duquel le recalcul est dit différent du montant figé au marquage. */
export const SEUIL_ECART_FIGE_USD = 0.005;

export type LigneDeclaration = {
  type: TypeTaxe;
  libelle: string;
  detail: string;
  /** Montant AFFICHÉ : le montant figé au marquage quand la taxe est déclarée ou payée, sinon le recalcul. */
  montantUSD: number;
  montantCDF: number;
  /** Recalcul d'aujourd'hui depuis les lignes de paie (égal au montant affiché tant que rien n'est marqué). */
  recalculUSD: number;
  recalculCDF: number;
  /** Montant figé au marquage (déclaré / payé) ; null tant que la taxe est « À déclarer ». */
  fige: { montantUSD: number; montantCDF: number; marqueLe: Date | null } | null;
  /** Vrai quand la paie recalculée donne un autre montant que celui déclaré : à signaler, jamais à corriger en silence. */
  ecartAvecFige: boolean;
  echeance: Date;
  echeanceAValider: boolean; // délai non confirmé par un comptable
  statut: StatutDeclaration;
};

export type BordereauDeclarations = {
  lignes: LigneDeclaration[];
  tauxChange: number;
  /** Des bulletins du mois ne sont ni validés ni payés : les montants peuvent encore changer. */
  provisoire: boolean;
  nbNonValides: number;
  nbBulletins: number;
};

type Libelle = { libelle: string; echeanceAValider: boolean };
const LIBELLES: Record<TypeTaxe, Libelle> = {
  CNSS: { libelle: "CNSS", echeanceAValider: false },
  IPR: { libelle: "IPR", echeanceAValider: true },
  INPP: { libelle: "INPP", echeanceAValider: true },
  ONEM: { libelle: "ONEM", echeanceAValider: true },
};

/** Taux des cotisations tels que les PARAMÈTRES LÉGAUX de l'exercice actif les portent (fractions : 0,05 = 5 %). */
export type TauxCotisations = { cnssSalarie: number | null; cnssPatronal: number | null; inpp: number | null; onem: number | null };

export async function chargerTauxCotisations(): Promise<TauxCotisations> {
  const exercice = await prisma.exerciceFiscal.findFirst({
    where: { actif: true },
    select: { parametres: { where: { cle: { in: ["cnss_salarie", "cnss_patronal_pensions", "cnss_patronal_risques", "cnss_patronal_famille", "inpp_taux", "onem_taux"] } }, select: { cle: true, valeur: true } } },
  });
  const v = new Map((exercice?.parametres ?? []).map((p) => [p.cle, p.valeur === null ? null : Number(p.valeur)]));
  const lire = (cle: string) => v.get(cle) ?? null;
  const patronal = ["cnss_patronal_pensions", "cnss_patronal_risques", "cnss_patronal_famille"].map(lire);
  return {
    cnssSalarie: lire("cnss_salarie"),
    // La part patronale n'a de taux que si ses trois composantes sont connues (jamais une somme partielle).
    cnssPatronal: patronal.every((x) => x !== null) ? (patronal as number[]).reduce((a, b) => a + b, 0) : null,
    inpp: lire("inpp_taux"),
    onem: lire("onem_taux"),
  };
}

const pct = (fraction: number) => `${formaterNombre(Math.round(fraction * 10000) / 100, { maximumFractionDigits: 2 })} %`;
const avecTaux = (taux: number | null) => (taux === null ? "" : ` (${pct(taux)})`);

/** Libellé « Nature » de chaque organisme : les taux viennent des paramètres légaux, jamais d'un nombre en dur. */
export function detailDeclaration(type: TypeTaxe, t: TauxCotisations): string {
  switch (type) {
    case "CNSS":
      return `Part salariale${avecTaux(t.cnssSalarie)} + part patronale${avecTaux(t.cnssPatronal)} — à déclarer avant le 15 du mois suivant`;
    case "IPR":
      return "Impôt professionnel sur les rémunérations retenu à la source — délai À VALIDER";
    case "INPP":
      return `Cotisation patronale formation professionnelle${avecTaux(t.inpp)} — délai À VALIDER`;
    case "ONEM":
      return `Cotisation patronale Office National de l'Emploi${avecTaux(t.onem)} — délai À VALIDER`;
  }
}

/**
 * Calcule le bordereau des déclarations d'un mois de paie : montants agrégés depuis les
 * lignes de paie, échéance au 15 du mois SUIVANT (CNSS confirmé ; autres À VALIDER),
 * et statut de suivi (A_DECLARER tant que le directeur ne l'a pas marqué).
 *
 * Deux garde-fous (audit paie du 2026-10-10) :
 *  - `provisoire` : tant que des bulletins du mois ne sont ni validés ni payés, le bordereau n'est
 *    qu'un calcul en cours — l'écran, le PDF et l'Excel le disent, et le marquage est refusé ;
 *  - une taxe DÉCLARÉE ou PAYÉE affiche le montant FIGÉ au marquage (ce qui a été déclaré), pas le
 *    recalcul du jour ; si le recalcul diffère, `ecartAvecFige` le signale.
 * Retourne null si aucune paie n'est calculée pour ce mois.
 */
export async function calculerDeclarationsMois(
  mois: number,
  annee: number
): Promise<BordereauDeclarations | null> {
  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: true },
  });
  if (!run) return null;
  // Lignes hors calcul (ligne rouverte d'un salarié sorti du calcul) : jamais déclarées (paie-hors-calcul.ts).
  const lignesRun = await lignesComptees(prisma, run.lignes);
  if (lignesRun.length === 0) return null;
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

  const [suivis, tauxCotisations] = await Promise.all([
    prisma.declarationTaxe.findMany({ where: { mois, annee } }),
    chargerTauxCotisations(),
  ]);

  const nbNonValides = lignesRun.filter((l) => l.statutPaiement === "PAS_VALIDE").length;

  const lignes: LigneDeclaration[] = (Object.keys(montants) as TypeTaxe[]).map((type) => {
    const recalculUSD = montants[type];
    const recalculCDF = montants[type] * tauxChange;
    const suivi = suivis.find((s) => s.type === type);
    const statut: StatutDeclaration = suivi?.statut ?? "A_DECLARER";
    // Déclarée ou payée : le montant qui fait foi est celui figé au marquage.
    const fige = suivi && statut !== "A_DECLARER"
      ? { montantUSD: Number(suivi.montantUSD), montantCDF: Number(suivi.montantCDF), marqueLe: suivi.dateMarquage }
      : null;
    return {
      type,
      libelle: LIBELLES[type].libelle,
      detail: detailDeclaration(type, tauxCotisations),
      montantUSD: fige ? fige.montantUSD : recalculUSD,
      montantCDF: fige ? fige.montantCDF : recalculCDF,
      recalculUSD,
      recalculCDF,
      fige,
      ecartAvecFige: fige !== null && Math.abs(fige.montantUSD - recalculUSD) >= SEUIL_ECART_FIGE_USD,
      echeance,
      echeanceAValider: LIBELLES[type].echeanceAValider,
      statut,
    };
  });

  return { lignes, tauxChange, provisoire: nbNonValides > 0, nbNonValides, nbBulletins: lignesRun.length };
}
