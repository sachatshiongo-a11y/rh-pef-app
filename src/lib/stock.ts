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

/** Formate un montant USD (2 décimales) — ou tiret si nul/absent. */
export function usd(v: Prisma.Decimal | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** Formate une quantité (jusqu'à 3 décimales, sans zéros inutiles). */
export function qte(v: Prisma.Decimal | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}
