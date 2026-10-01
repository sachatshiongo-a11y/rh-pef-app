import type { Prisma } from "@prisma/client";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import type { FactureRow } from "./factures-client";

// Une facture telle que la liste la montre — UN seul passage de la base à la ligne d'écran, partagé
// par l'écran Factures et par l'onglet Factures de la fiche fournisseur (mêmes pastilles, mêmes
// échéances : les deux écrans ne peuvent plus diverger).

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);
const JOUR_MS = 86400000;

/** Jours restants avant l'échéance (négatif si dépassée) ; null si réglée ou sans échéance. */
export function joursAvant(echeance: Date | null, statut: string): number | null {
  if (statut === "REGLEE" || !echeance) return null;
  const e = new Date(echeance);
  const e0 = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const a0 = jourCivilKinshasa(new Date()).getTime(); // aujourd'hui à Kinshasa
  return Math.round((e0 - a0) / JOUR_MS);
}

type FactureBase = {
  id: string; fournisseurId: string | null; fournisseurNom: string; numero: string | null;
  date: Date | null; dateEcheance: Date | null; datePaiement: Date | null;
  montantUSD: Prisma.Decimal; resteAPayerUSD: Prisma.Decimal; statut: string; documentUrl: string | null;
  fournisseur?: { nom: string } | null;
};

/** `enAttente` : ids des factures dont un paiement attend la Direction (`ciblesEnAttente().factures`). */
export function versFactureRow(x: FactureBase, enAttente: Set<string>): FactureRow {
  return {
    id: x.id, nom: x.fournisseur?.nom ?? x.fournisseurNom, fournisseurId: x.fournisseurId ?? null, numero: x.numero,
    date: d(x.date), echeance: d(x.dateEcheance),
    joursRestants: joursAvant(x.dateEcheance, x.statut), datePaiement: d(x.datePaiement),
    montant: x.montantUSD.toString(), reste: Number(x.resteAPayerUSD), statut: x.statut,
    documentUrl: x.documentUrl ?? null,
    paiementDemande: enAttente.has(x.id),
  };
}
