import "server-only";

import { prisma } from "@/lib/prisma";
import type { ParametresPaie } from "@/lib/payroll";

/**
 * Charge l'ensemble des paramètres de paie :
 * — opérationnels (taux de change, mois/année courants) depuis Config ;
 * — légaux (CNSS, IPR, INPP, ONEM, HS...) depuis ParametreLegal de l'exercice fiscal actif,
 *   versionnés et modifiables uniquement par l'ADMIN.
 * Lève une erreur si l'exercice actif ou un paramètre requis est manquant : on ne calcule
 * jamais une paie avec des valeurs implicites.
 */
export async function chargerParametresPaie(): Promise<ParametresPaie> {
  const [config, exercice] = await Promise.all([
    prisma.config.findUniqueOrThrow({ where: { id: "singleton" } }),
    prisma.exerciceFiscal.findFirst({
      where: { actif: true },
      include: { parametres: true, tranchesIpr: { orderBy: { ordre: "asc" } } },
    }),
  ]);

  if (!exercice) {
    throw new Error(
      "Aucun exercice fiscal actif : chargez les paramètres légaux (scripts/seed-legal-2026.ts)."
    );
  }

  const valeurs = new Map(exercice.parametres.map((p) => [p.cle, p.valeur]));

  const requis = (cle: string): number => {
    const v = valeurs.get(cle);
    if (v === undefined || v === null) {
      throw new Error(`Paramètre légal manquant ou vide : ${cle} (exercice ${exercice.annee}).`);
    }
    return Number(v);
  };
  const optionnel = (cle: string): number | null => {
    const v = valeurs.get(cle);
    return v === undefined || v === null ? null : Number(v);
  };

  if (exercice.tranchesIpr.length === 0) {
    throw new Error(`Barème IPR vide pour l'exercice ${exercice.annee}.`);
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
  };
}
