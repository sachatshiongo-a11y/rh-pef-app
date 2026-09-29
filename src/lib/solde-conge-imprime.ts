import { jourKinshasa } from "@/lib/heure-kinshasa";
import { formaterNombre } from "@/lib/montant";

/**
 * LE SOLDE IMPRIMÉ SUR UNE DEMANDE DE CONGÉ — figé à l'approbation (décision Direction 2026-09-29).
 *
 * Le PDF d'une demande est REFAIT à chaque ouverture. Avant, il imprimait le solde du jour
 * d'ouverture : la même demande approuvée, rouverte trois mois plus tard, portait un autre chiffre.
 * Désormais :
 *  - demande APPROUVÉE avec instantané : le solde FIGÉ à l'approbation, daté de l'approbation.
 *    C'est le solde « après approbation », CETTE demande comprise (quand son type entame le solde)
 *    — exactement ce que le PDF imprimait le jour même, puisque la source unique compte toutes les
 *    demandes approuvées de l'année ;
 *  - demande APPROUVÉE AVANT ce changement (pas d'instantané) : on ne reconstitue rien (règle
 *    maison, pas de rétro-simulation). Le PDF imprime le solde du jour, avec sa date d'ÉDITION
 *    écrite en toutes lettres : le lecteur sait que ce chiffre n'est pas celui de l'approbation ;
 *  - demande EN ATTENTE ou REFUSÉE : le solde du jour, daté de l'édition.
 *
 * Module pur (ni base, ni `server-only`) : testable tel quel, importé par le PDF.
 */
export type SoldeImprime = {
  jours: number;
  /** Instant auquel le chiffre vaut : l'approbation (figé) ou l'édition du document. */
  au: Date;
  origine: "APPROBATION" | "EDITION";
};

type DemandeAvecInstantane = {
  statut: string;
  soldeFigeJours: { toString(): string } | number | null;
  soldeFigeLe: Date | null;
};

/**
 * Le solde figé d'une demande, s'il fait foi : seulement sur une demande APPROUVÉE portant un
 * instantané complet. Un instantané résiduel sur une demande qui a quitté APPROUVÉ (il est effacé
 * à ce moment-là, ceci n'est qu'une ceinture) n'est jamais imprimé.
 */
export function soldeFigeDe(d: DemandeAvecInstantane): SoldeImprime | null {
  if (d.statut !== "APPROUVE" || d.soldeFigeJours === null || d.soldeFigeLe === null) return null;
  return { jours: Number(d.soldeFigeJours.toString()), au: new Date(d.soldeFigeLe), origine: "APPROBATION" };
}

/** Intitulé de l'encadré du PDF. */
export function libelleSolde(s: SoldeImprime): string {
  return s.origine === "APPROBATION" ? "Solde de congé annuel après approbation" : "Solde de congé annuel disponible";
}

/** Date du chiffre, jour de Kinshasa : « au 29/09/2026, date d'approbation » ou « …, date d'édition ». */
export function dateDuSolde(s: SoldeImprime): string {
  return `au ${jourKinshasa(s.au)}, date ${s.origine === "APPROBATION" ? "d'approbation" : "d'édition"}`;
}

/** « 12,5 jours » — virgule française, espaces normalisées (police Optima du PDF). */
export function joursDuSolde(s: SoldeImprime): string {
  return `${formaterNombre(s.jours, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} jours`;
}
