import type { Prisma, StatutFacture } from "@prisma/client";
import { montantsFacture, type MontantsFactureBrut } from "@/lib/facture-devise";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

// STATUT « ÉCHUE » — UNE SEULE FONCTION (audit du 10/10/2026, constat 3).
//
// Le statut stocké `ECHUE_NON_REGLEE` n'était écrit qu'à la création ou au règlement d'une facture : une
// facture saisie « À régler » le 1er septembre, échue le 30, restait « À régler » à vie. Le KPI « Échu »,
// le filtre « Échues », l'alerte des factures et les rapports lisaient cette colonne figée : l'échu
// affiché était FAUX, en moins (dette en retard comptée comme saine).
//
// Désormais l'échéance se juge à la LECTURE : une facture est échue quand il lui reste quelque chose à
// payer ET que son échéance est antérieure au jour civil de Kinshasa. Le statut stocké reste ce qu'il
// est (REGLEE / pas REGLEE font foi pour « payée ») ; seul « échue ou pas » se calcule. Tout écran,
// filtre, KPI, alerte, export qui parlait d'« échue » passe par ce module.

export type StatutFactureLu = StatutFacture;

type FactureStatut = MontantsFactureBrut & { statut: string; dateEcheance: Date | string | null };

/** Le jour civil de Kinshasa en `AAAA-MM-JJ` — la référence de toute comparaison d'échéance. */
export const aujourdhuiEcheance = (): string => jourCourantKinshasaISO();

const jourDe = (d: Date | string | null): string | null => {
  if (d === null || d === undefined) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
};

/** Vrai si la facture a un reste à payer et une échéance DÉPASSÉE (strictement antérieure au jour de référence). */
export function estEchue(f: FactureStatut, auj: string = aujourdhuiEcheance()): boolean {
  if (f.statut === "REGLEE") return false;
  if (montantsFacture(f).reste <= 0.001) return false;
  const e = jourDe(f.dateEcheance);
  return e !== null && e < auj;
}

/** Le statut À AFFICHER : REGLEE si soldée, ECHUE_NON_REGLEE si échue, sinon A_REGLER. */
export function statutAffiche(f: FactureStatut, auj: string = aujourdhuiEcheance()): StatutFactureLu {
  if (f.statut === "REGLEE" || montantsFacture(f).reste <= 0.001) return "REGLEE";
  return estEchue(f, auj) ? "ECHUE_NON_REGLEE" : "A_REGLER";
}

const RESTE_OUVERT: Prisma.FactureFournisseurWhereInput = { OR: [{ resteAPayerUSD: { gt: 0 } }, { resteAPayerCDF: { gt: 0 } }] };

/** Filtre Prisma : factures échues (reste à payer, échéance dépassée). */
export function whereEchues(auj: string = aujourdhuiEcheance()): Prisma.FactureFournisseurWhereInput {
  return { statut: { not: "REGLEE" }, dateEcheance: { lt: new Date(auj) }, ...RESTE_OUVERT };
}

/** Filtre Prisma : factures à régler PAS ENCORE échues (échéance à venir, ou aucune). */
export function whereAReglerNonEchues(auj: string = aujourdhuiEcheance()): Prisma.FactureFournisseurWhereInput {
  return { statut: { not: "REGLEE" }, AND: [RESTE_OUVERT, { OR: [{ dateEcheance: null }, { dateEcheance: { gte: new Date(auj) } }] }] };
}

/** Filtre Prisma : factures à payer (échues ou non) — tout ce qui n'est pas réglé. */
export const whereDues: Prisma.FactureFournisseurWhereInput = { statut: { not: "REGLEE" } };

/** Filtre Prisma selon le paramètre d'URL `?statut=` de l'écran Factures ; `{}` pour « Toutes ». */
export function whereSelonFiltreStatut(f: string | undefined, auj: string = aujourdhuiEcheance()): Prisma.FactureFournisseurWhereInput {
  if (f === "du") return whereDues;
  if (f === "ECHUE_NON_REGLEE") return whereEchues(auj);
  if (f === "A_REGLER") return whereAReglerNonEchues(auj);
  if (f === "REGLEE") return { statut: "REGLEE" };
  return {};
}
