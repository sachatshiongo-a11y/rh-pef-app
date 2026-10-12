import type { Employee } from "@prisma/client";

/**
 * Champs de la FICHE SALARIÉ qui entrent dans un bulletin et qui doivent rester ceux du jour de la
 * validation quand une ligne VALIDÉE ou PAYÉE est réimprimée : salaire de base (donc taux horaire
 * affiché), personnes à charge, banque / mode de paiement, catégories. L'identité (nom, matricule,
 * adresse…) reste celle de la fiche : une faute corrigée depuis doit disparaître du document.
 * Audit paie du 2026-10-10 : une hausse de salaire saisie après coup réécrivait « Salaire de base »
 * et « Taux horaire » d'un bulletin déjà payé.
 */
export const CHAMPS_FICHE_FIGES = [
  "salaireMensuel",
  "enfants",
  "banque",
  "compteBancaire",
  "mobileMoney",
  "modePaiement",
  "categorie",
  "categorieProfessionnelle",
] as const satisfies readonly (keyof Employee)[];

/** La fiche du jour, dont les champs financiers sont remplacés par ceux de l'instantané (JSON). */
export function fusionnerFicheFigee(fiche: Employee, instantane: Record<string, unknown> | undefined | null): Employee {
  if (!instantane) return fiche;
  const figes: Record<string, unknown> = {};
  for (const champ of CHAMPS_FICHE_FIGES) if (champ in instantane) figes[champ] = instantane[champ];
  return { ...fiche, ...figes } as Employee;
}
