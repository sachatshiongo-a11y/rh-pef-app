import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { montantsFacture, type MontantsFactureBrut } from "@/lib/facture-devise";
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

type FactureBase = MontantsFactureBrut & {
  id: string; fournisseurId: string | null; fournisseurNom: string; numero: string | null;
  date: Date | null; dateEcheance: Date | null; datePaiement: Date | null;
  statut: string; documentUrl: string | null;
  fournisseur?: { nom: string } | null;
};

/** `enAttente` : ids des factures dont un paiement attend la Direction (`ciblesEnAttente().factures`). */
export function versFactureRow(x: FactureBase, enAttente: Set<string>): FactureRow {
  // Montant et reste DANS LA DEVISE de la facture (factures en francs depuis le 2026-10-09).
  const m = montantsFacture(x);
  return {
    id: x.id, nom: x.fournisseur?.nom ?? x.fournisseurNom, fournisseurId: x.fournisseurId ?? null, numero: x.numero,
    date: d(x.date), echeance: d(x.dateEcheance),
    joursRestants: joursAvant(x.dateEcheance, x.statut), datePaiement: d(x.datePaiement),
    devise: m.devise, montant: String(m.montant), reste: m.reste, statut: x.statut,
    documentUrl: x.documentUrl ?? null,
    paiementDemande: enAttente.has(x.id),
  };
}
