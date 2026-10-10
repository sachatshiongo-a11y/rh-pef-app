import "server-only";
import { Prisma } from "@prisma/client";
import { aujourdhuiEcheance } from "@/lib/facture-echue";

/**
 * La condition SQL « facture échue » (la même règle que `estEchue`), pour les agrégats bruts :
 * `FILTER (WHERE ${sqlEchue()})`. Colonnes non qualifiées par défaut ; `alias` pour une jointure.
 */
export function sqlEchue(auj: string = aujourdhuiEcheance(), alias?: string): Prisma.Sql {
  const c = (col: string) => Prisma.raw(alias ? `${alias}."${col}"` : `"${col}"`);
  return Prisma.sql`(${c("statut")} <> 'REGLEE' AND ${c("dateEcheance")} < ${auj}::date AND (COALESCE(${c("resteAPayerUSD")}, 0) > 0 OR COALESCE(${c("resteAPayerCDF")}, 0) > 0))`;
}
