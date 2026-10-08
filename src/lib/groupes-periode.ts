import { lundiDe } from "@/lib/dates-fr";

// Historiques « Par jour / Par semaine / Par mois » (Liste d'achat, Légumes) : un groupe est une tranche de
// dates. Paginés côté serveur, un groupe peut être COUPÉ par une frontière de page ; son compteur et son total
// se relisent alors sur sa tranche entière (`bornesGroupe`), pas sur les lignes de la page (2026-10-08).

export type PeriodeGroupe = "jour" | "semaine" | "mois";

/** Les dates `[gte, lt[` du groupe qui contient `d` (minuit UTC : les colonnes sont des dates pures). PURE. */
export function bornesGroupe(periode: PeriodeGroupe, d: Date): { gte: Date; lt: Date } {
  if (periode === "jour") {
    const gte = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return { gte, lt: new Date(gte.getTime() + 86_400_000) };
  }
  if (periode === "semaine") {
    const gte = lundiDe(d);
    return { gte, lt: new Date(gte.getTime() + 7 * 86_400_000) };
  }
  return { gte: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), lt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
}
