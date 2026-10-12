import { reconstituerBrutDepuisNet, type ParametresPaie } from "@/lib/payroll";

/**
 * Brut reconstitué d'un salaire de contrat saisi en NET, exprimé dans la devise du contrat.
 *
 * `reconstituerBrutDepuisNet` travaille en DOLLARS (barème IPR converti au taux, centimes de dollar).
 * Un contrat en francs doit donc être converti en dollars au taux de la paie AVANT la reconstitution,
 * puis le brut reconverti en francs — sans quoi 600 000 FC étaient lus comme 600 000 $ (audit du
 * 2026-10-10 : brut imprimé absurde sur les contrats en CDF). `null` si le taux est inexploitable.
 */
export function brutDepuisNetContrat(
  netSaisi: number,
  devise: string,
  params: ParametresPaie,
  personnesACharge: number,
): number | null {
  if (devise === "CDF") {
    const taux = params.tauxChangeCDF;
    if (!(taux > 0)) return null;
    const brutUSD = reconstituerBrutDepuisNet(netSaisi / taux, params, personnesACharge);
    return brutUSD * taux;
  }
  return reconstituerBrutDepuisNet(netSaisi, params, personnesACharge);
}
