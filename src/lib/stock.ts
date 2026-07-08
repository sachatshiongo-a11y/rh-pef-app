// Helpers du module Stock & Achats (calculs d'affichage, pas de logique métier figée en base).
import type { Prisma } from "@prisma/client";

export type NiveauAlerte = "URGENT" | "APPRO" | "OK";

/**
 * Niveau d'alerte d'un article, calculé depuis des seuils MODIFIABLES par article :
 *   URGENT              si quantité ≤ seuilUrgent
 *   APPRO (à réappro.)  si seuilUrgent < quantité ≤ stockMinimum
 *   OK (satisfaisant)   si quantité > stockMinimum
 */
export function niveauAlerte(
  quantite: Prisma.Decimal | number,
  seuilUrgent: Prisma.Decimal | number,
  stockMinimum: Prisma.Decimal | number
): NiveauAlerte {
  const q = Number(quantite);
  const su = Number(seuilUrgent);
  const min = Number(stockMinimum);
  // Aucun seuil configuré (ni minimum, ni seuil urgent) = article non suivi pour les alertes.
  // Évite de noyer le tableau de bord d'« Urgent » pour des articles à 0 sans réappro. défini.
  if (su <= 0 && min <= 0) return "OK";
  if (q <= su) return "URGENT";
  if (q <= min) return "APPRO";
  return "OK";
}

export const ALERTE_LABEL: Record<NiveauAlerte, string> = {
  URGENT: "Urgent",
  APPRO: "À réapprovisionner",
  OK: "Satisfaisant",
};

export const ALERTE_CLASSE: Record<NiveauAlerte, string> = {
  URGENT: "bg-red-100 text-red-800",
  APPRO: "bg-amber-100 text-amber-800",
  OK: "bg-emerald-100 text-emerald-800",
};

/** Affiche un délai de paiement lisible : « 30 » → « 30 jours », « 30 jours »/« livraison » inchangés. */
export function delaiPaiementLabel(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  if (!v) return "—";
  if (/^\d+$/.test(v)) return `${v} jours`;
  return v;
}

/** Écart d'inventaire (%) au-delà duquel une explication est exigée. */
export const SEUIL_TOLERANCE_PCT = 10;

export const DOMAINE_LABEL: Record<string, string> = {
  NOURRITURE: "Nourriture",
  BOISSON: "Boissons",
  AUTRE: "Autre",
};

export const STATUT_FACTURE_LABEL: Record<string, string> = {
  A_REGLER: "À régler",
  REGLEE: "Réglée",
  ECHUE_NON_REGLEE: "Échue non réglée",
};

export const STATUT_FACTURE_CLASSE: Record<string, string> = {
  A_REGLER: "bg-amber-100 text-amber-800",
  REGLEE: "bg-emerald-100 text-emerald-800",
  ECHUE_NON_REGLEE: "bg-red-100 text-red-800",
};

export const STATUT_BC_LABEL: Record<string, string> = {
  BROUILLON: "Brouillon",
  VALIDE: "Validé",
  ENVOYE: "Envoyé",
  RECU_PARTIEL: "Reçu partiel",
  RECU: "Reçu",
  ANNULE: "Annulé",
};

export const STATUT_BC_CLASSE: Record<string, string> = {
  BROUILLON: "bg-muted text-muted-foreground",
  VALIDE: "bg-indigo-100 text-indigo-800",
  ENVOYE: "bg-blue-100 text-blue-800",
  RECU_PARTIEL: "bg-amber-100 text-amber-800",
  RECU: "bg-emerald-100 text-emerald-800",
  ANNULE: "bg-red-100 text-red-800",
};

/** Formate un montant USD (2 décimales) — ou tiret si nul/absent. */
export function usd(v: Prisma.Decimal | number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** Formate une quantité (jusqu'à 3 décimales, sans zéros inutiles). */
export function qte(v: Prisma.Decimal | number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}
