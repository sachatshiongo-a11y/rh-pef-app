import type { PrismaClient } from "@prisma/client";
import type { ParametresPaie } from "../src/lib/payroll";

/**
 * Même logique que src/lib/config.ts (chargerParametresPaie), sans l'import "server-only",
 * afin d'être utilisable dans un script Node hors du contexte Next.js.
 * Aucune valeur légale n'est codée en dur : tout vient de ParametreLegal (exercice actif).
 */
export async function chargerParametresPaieDirect(prisma: PrismaClient): Promise<ParametresPaie> {
  const [config, exercice] = await Promise.all([
    prisma.config.findUniqueOrThrow({ where: { id: "singleton" } }),
    prisma.exerciceFiscal.findFirst({
      where: { actif: true },
      include: { parametres: true, tranchesIpr: { orderBy: { ordre: "asc" } } },
    }),
  ]);

  if (!exercice) {
    throw new Error("Aucun exercice fiscal actif : exécutez scripts/seed-legal-2026.ts.");
  }

  const valeurs = new Map(exercice.parametres.map((p) => [p.cle, p.valeur]));
  const requis = (cle: string): number => {
    const v = valeurs.get(cle);
    if (v === undefined || v === null) {
      throw new Error(`Paramètre légal manquant : ${cle} (exercice ${exercice.annee}).`);
    }
    return Number(v);
  };
  const optionnel = (cle: string): number | null => {
    const v = valeurs.get(cle);
    return v === undefined || v === null ? null : Number(v);
  };

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
    salairesSaisisEnNet: optionnel("salaires_saisis_en_net") === 1,
  };
}
