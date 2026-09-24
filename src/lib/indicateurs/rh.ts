import "server-only";

import { prisma } from "@/lib/prisma";
import { salaireNetUSD } from "@/lib/paie-net";

// Indicateurs de paie partagés : UNE seule source de vérité pour l'accueil RH et le tableau de bord
// de l'Exploitation. Les formules sont celles que l'accueil RH portait jusqu'ici, recopiées à
// l'identique (un test de non-régression prouve que ses chiffres n'ont pas bougé d'un centime).
// Ne renvoie que des TOTAUX : aucune donnée individuelle ne sort d'ici.

export type TotauxPaie = {
  masseNette: number;
  coutEmployeur: number;
  hsValorisees: number;
  transport: number;
  fraisMedicaux: number;
};

export type PointHistoriquePaie = { mois: number; annee: number; net: number; cout: number };

export type IndicateursPaie = {
  mois: number;
  annee: number;
  runExiste: boolean;
  statuts: { total: number; nbPaye: number; nbValide: number; nbPasValide: number };
  totaux: TotauxPaie;
  /** Les 6 dernières paies enregistrées, de la plus ancienne à la plus récente. */
  historique: PointHistoriquePaie[];
  /**
   * Variation en % de la DERNIÈRE paie enregistrée sur la précédente (règle de l'accueil RH, gardée
   * telle quelle) ; null s'il y a moins de deux paies ou si la précédente vaut 0.
   */
  variationNet: number | null;
  variationCout: number | null;
};

/** Mois de paie courant : `Config.moisCourant`/`anneeCourante`, à défaut le mois civil du serveur. */
export function moisDePaie(
  config: { moisCourant: number; anneeCourante: number } | null,
  maintenant: Date,
): { mois: number; annee: number } {
  return {
    mois: config?.moisCourant ?? maintenant.getMonth() + 1,
    annee: config?.anneeCourante ?? maintenant.getFullYear(),
  };
}

export async function indicateursPaieDuMois(mois: number, annee: number): Promise<IndicateursPaie> {
  const [run, runsHistorique] = await Promise.all([
    prisma.payrollRun.findUnique({ where: { mois_annee: { mois, annee } }, include: { lignes: true } }),
    prisma.payrollRun.findMany({
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      take: 6,
      include: { lignes: { select: { salNetUSD: true, transportUSD: true, coutEmployeurUSD: true } } },
    }),
  ]);

  const lignes = run?.lignes ?? [];
  const totaux: TotauxPaie = {
    masseNette: lignes.reduce((a, l) => a + salaireNetUSD(l), 0),
    coutEmployeur: lignes.reduce((a, l) => a + Number(l.coutEmployeurUSD), 0),
    hsValorisees: lignes.reduce((a, l) => a + Number(l.hsValorisee), 0),
    transport: lignes.reduce((a, l) => a + Number(l.transportUSD), 0),
    fraisMedicaux: lignes.reduce((a, l) => a + Number(l.fraisMedicauxUSD), 0),
  };

  const historique: PointHistoriquePaie[] = [...runsHistorique].reverse().map((r) => ({
    mois: r.mois,
    annee: r.annee,
    net: r.lignes.reduce((a, l) => a + salaireNetUSD(l), 0),
    cout: r.lignes.reduce((a, l) => a + Number(l.coutEmployeurUSD), 0),
  }));
  const variation = (cle: "net" | "cout"): number | null => {
    if (historique.length < 2) return null;
    const prec = historique[historique.length - 2]![cle];
    const cur = historique[historique.length - 1]![cle];
    if (prec === 0) return null;
    return ((cur - prec) / prec) * 100;
  };

  return {
    mois,
    annee,
    runExiste: !!run,
    statuts: {
      total: lignes.length,
      nbPaye: lignes.filter((l) => l.statutPaiement === "PAYE").length,
      nbValide: lignes.filter((l) => l.statutPaiement === "VALIDE").length,
      nbPasValide: lignes.filter((l) => l.statutPaiement === "PAS_VALIDE").length,
    },
    totaux,
    historique,
    variationNet: variation("net"),
    variationCout: variation("cout"),
  };
}
