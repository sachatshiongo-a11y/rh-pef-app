import "server-only";

import { prisma } from "@/lib/prisma";
import type { ParametresPaie } from "@/lib/payroll";
import type { Prisma } from "@prisma/client";

/**
 * Mois d'effet AAAAMM (`paie_reference_planning_depuis`), saisi en texte libre dans Paramètres.
 * N'accepte qu'un ENTIER AAAAMM avec 2000 ≤ AAAA ≤ 2100 et 1 ≤ MM ≤ 12 ; tout le reste (décimal,
 * « 9 », « 202613 », « 202600 », NaN, vide) vaut `null`, c'est-à-dire l'ancienne règle partout.
 * La comparaison `annee*100+mois >= depuis` de `calculerReferenceMois` ferait sinon passer TOUS
 * les mois (« 9 ») ou aucun avant 2027 (« 202613 ») sans que personne ne le voie. Pure.
 */
export function lireMoisEffet(v: number | null | undefined): number | null {
  if (v == null || !Number.isInteger(v)) return null;
  const annee = Math.floor(v / 100);
  const mois = v % 100;
  if (annee < 2000 || annee > 2100) return null;
  if (mois < 1 || mois > 12) return null;
  return v;
}

/**
 * Un paramètre légal OBLIGATOIRE manque (ou aucun exercice fiscal n'est actif). Le message dit
 * lequel et pour quel exercice : il est fait pour être montré à la Direction, telle quelle. Classe
 * dédiée pour que les routes de document puissent le rendre lisible (409) au lieu d'une erreur 500
 * muette — les autres appelants, qui attrapent `Error`, n'y voient aucune différence.
 */
export class ParametreLegalManquantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParametreLegalManquantError";
  }
}

const AUCUN_EXERCICE_ACTIF = "Aucun exercice fiscal actif : chargez les paramètres légaux (scripts/seed-legal-2026.ts).";

/**
 * Les valeurs de quelques clés de l'exercice fiscal ACTIF — jamais d'un autre exercice, même si
 * celui-là porte la clé et l'actif non. Clé absente ou vide = `null`, à l'appelant de décider si
 * c'est admissible. Lève si aucun exercice n'est actif.
 */
async function lireExerciceActif(
  db: Prisma.TransactionClient,
  cles: string[],
): Promise<{ annee: number; valeur: (cle: string) => number | null }> {
  const exercice = await db.exerciceFiscal.findFirst({
    where: { actif: true },
    select: { annee: true, parametres: { where: { cle: { in: cles } }, select: { cle: true, valeur: true } } },
  });
  if (!exercice) throw new ParametreLegalManquantError(AUCUN_EXERCICE_ACTIF);
  const valeurs = new Map(exercice.parametres.map((p) => [p.cle, p.valeur]));
  return {
    annee: exercice.annee,
    valeur: (cle) => {
      const v = valeurs.get(cle);
      return v === undefined || v === null ? null : Number(v);
    },
  };
}

/**
 * Les droits annuels de congé (jours) — la SEULE donnée de paie dont le solde de congé a besoin.
 *
 * Même source et même règle que `chargerParametresPaie().droitsCongesAnnuel` (clé
 * `droits_conges_annuel` de l'exercice fiscal ACTIF, obligatoire, sans valeur implicite) : même
 * chiffre. Mais le solde ne dépend plus du reste de la paie (ligne Config, clés CNSS/IPR/HS, barème
 * IPR) : une base neuve ou un passage d'exercice incomplet ne bloque plus les écrans de congé, les
 * PDF, ni surtout l'APPROBATION d'une demande (2026-09-29).
 * Lève encore si l'exercice actif ou cette clé-là manque — comme avant, pour les écrans ;
 * l'approbation, elle, sait s'en passer (`lib/solde-conge-fige.ts`).
 */
export async function chargerDroitsCongesAnnuel(db: Prisma.TransactionClient = prisma): Promise<number> {
  const exercice = await lireExerciceActif(db, ["droits_conges_annuel"]);
  return droitsCongesRequis(exercice);
}

function droitsCongesRequis({ annee, valeur }: { annee: number; valeur: (cle: string) => number | null }): number {
  const v = valeur("droits_conges_annuel");
  if (v === null) {
    throw new ParametreLegalManquantError(`Paramètre légal manquant ou vide : droits_conges_annuel (exercice ${annee}).`);
  }
  return v;
}

/** Ce que le contrat de travail imprime des paramètres légaux (`lib/pdf/contrat-buffer.ts`). */
export type ParametresLegauxContrat = {
  /** Obligatoire : le contrat ne s'imprime pas sans (même règle que le solde de congé). */
  droitsCongesAnnuel: number;
  /**
   * Facultatifs : aucune installation ne les pose d'office (ni seed ni migration), et le contrat a
   * une formulation prévue pour leur absence — « moyennant un préavis légal », qui renvoie au Code
   * du travail sans inventer de chiffre. Absents de l'exercice actif = `null`, jamais la valeur
   * d'un autre exercice.
   */
  preavisDemission: number | null;
  preavisLicenciement: number | null;
  /** Même lecture que `chargerParametresPaie().salairesSaisisEnNet` : absent = OFF. */
  salairesSaisisEnNet: boolean;
};

/**
 * Les paramètres légaux du CONTRAT DE TRAVAIL, tous lus dans l'exercice fiscal ACTIF.
 *
 * Pourquoi l'exercice actif et non celui de la date d'effet du contrat : un contrat régénéré montre
 * les conditions ACTUELLES — c'est ce que le salarié signe (`instantaneContrat`), et l'exemplaire
 * figé garde, lui, celles du jour de l'acceptation. Il imprime aussi le brut reconstitué par
 * `chargerParametresPaie` (exercice actif) : lire les préavis ailleurs mélangerait deux exercices
 * dans un même document. Et seul 2026 existe en base : un contrat pris effet en 2024 ou 2025 ne
 * s'imprimerait plus.
 *
 * Ne dépend PAS du reste de la paie (ligne Config, barème IPR…) : un contrat au BRUT s'imprime même
 * si la paie est incomplète — au NET, en revanche, `contrat-buffer` reconstitue le brut et exige
 * alors `chargerParametresPaie`. Lève si l'exercice actif ou `droits_conges_annuel` manque.
 */
export async function chargerParametresContrat(db: Prisma.TransactionClient = prisma): Promise<ParametresLegauxContrat> {
  const exercice = await lireExerciceActif(db, [
    "droits_conges_annuel", "preavis_jours_demission", "preavis_jours_licenciement", "salaires_saisis_en_net",
  ]);
  const { valeur } = exercice;
  return {
    droitsCongesAnnuel: droitsCongesRequis(exercice),
    preavisDemission: valeur("preavis_jours_demission"),
    preavisLicenciement: valeur("preavis_jours_licenciement"),
    salairesSaisisEnNet: valeur("salaires_saisis_en_net") === 1,
  };
}

/**
 * Charge l'ensemble des paramètres de paie :
 * — opérationnels (taux de change, mois/année courants) depuis Config ;
 * — légaux (CNSS, IPR, INPP, ONEM, HS...) depuis ParametreLegal de l'exercice fiscal actif,
 *   versionnés et modifiables uniquement par l'ADMIN.
 * Lève une erreur si l'exercice actif ou un paramètre requis est manquant : on ne calcule
 * jamais une paie avec des valeurs implicites.
 */
export async function chargerParametresPaie(db: Prisma.TransactionClient = prisma): Promise<ParametresPaie> {
  const [config, exercice] = await Promise.all([
    db.config.findUniqueOrThrow({ where: { id: "singleton" } }),
    db.exerciceFiscal.findFirst({
      where: { actif: true },
      include: { parametres: true, tranchesIpr: { orderBy: { ordre: "asc" } } },
    }),
  ]);

  if (!exercice) throw new ParametreLegalManquantError(AUCUN_EXERCICE_ACTIF);

  const valeurs = new Map(exercice.parametres.map((p) => [p.cle, p.valeur]));

  const requis = (cle: string): number => {
    const v = valeurs.get(cle);
    if (v === undefined || v === null) {
      throw new ParametreLegalManquantError(`Paramètre légal manquant ou vide : ${cle} (exercice ${exercice.annee}).`);
    }
    return Number(v);
  };
  const optionnel = (cle: string): number | null => {
    const v = valeurs.get(cle);
    return v === undefined || v === null ? null : Number(v);
  };

  if (exercice.tranchesIpr.length === 0) {
    throw new ParametreLegalManquantError(`Barème IPR vide pour l'exercice ${exercice.annee}.`);
  }

  return {
    tauxChangeCDF: Number(config.tauxChangeCDF),

    cnssSalarie: requis("cnss_salarie"),
    cnssPatronalPensions: requis("cnss_patronal_pensions"),
    cnssPatronalRisques: requis("cnss_patronal_risques"),
    cnssPatronalFamille: requis("cnss_patronal_famille"),
    plafondCnssMensuelCDF: optionnel("plafond_cnss_mensuel_cdf"),

    iprTranchesAnnuellesCDF: exercice.tranchesIpr.map((t) => ({
      ordre: t.ordre,
      plafondAnnuelCDF: t.plafondAnnuelCDF === null ? null : Number(t.plafondAnnuelCDF),
      taux: Number(t.taux),
    })),
    iprPlancherMensuelCDF: requis("ipr_plancher_mensuel_cdf"),
    iprPlafondTaux: requis("ipr_plafond_taux"),
    iprReductionFamilleTaux: requis("ipr_reduction_famille_taux"),
    iprReductionFamilleMax: requis("ipr_reduction_famille_max"),
    iprBase: requis("ipr_base"),

    inppTaux: requis("inpp_taux"),
    onemTaux: requis("onem_taux"),

    hsSeuilHebdoH: requis("hs_seuil_hebdo_h"),
    hsMajTranche1: requis("hs_maj_tranche1"),
    hsMajTranche2: requis("hs_maj_tranche2"),
    hsMajDimancheFerie: requis("hs_maj_dimanche_ferie"),

    allocFamilialeParEnfantUSD: requis("alloc_familiale_par_enfant_usd"),
    joursOuvrablesMois: requis("jours_ouvrables_mois"),
    droitsCongesAnnuel: requis("droits_conges_annuel"),

    // Interruteur d'interprétation des salaires saisis (2026-07-22, voir ParametresPaie dans
    // payroll.ts). IMPORTANT — défaut OFF (false) si le paramètre est ABSENT de l'exercice actif :
    // sur la base de prod existante (exercice 2026 seedé AVANT l'introduction de cette clé), aucun
    // gross-up ne doit s'appliquer tant que le directeur ne l'active pas explicitement dans
    // Paramètres. `optionnel()` renvoie `null` si la clé n'existe pas → traité comme `false` ici
    // (jamais `requis()`, qui lèverait une erreur bloquant toute la paie sur les bases n'ayant pas
    // encore ce paramètre seedé).
    salairesSaisisEnNet: optionnel("salaires_saisis_en_net") === 1,
    // Date d'effet de la paie sur heures planifiées (AAAAMM). Absente, vide ou MAL FORMÉE = ancienne
    // règle : `optionnel`, jamais `requis`, pour ne bloquer aucune base pas encore migrée ; et
    // `lireMoisEffet`, parce qu'une saisie libre de « 9 » ferait passer juin et juillet en planning.
    referencePlanningDepuis: lireMoisEffet(optionnel("paie_reference_planning_depuis")),
  };
}
