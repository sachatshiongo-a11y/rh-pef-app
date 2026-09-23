// Libellés de la référence d'heures d'une ligne de paie — module sans dépendance (écran, fiche, PDF).
// Seul endroit où ces libellés sont écrits.
import type { SourceReference } from "@/lib/paie-reference";

export const LIBELLE_SOURCE_REFERENCE: Record<SourceReference, string> = {
  PLANNING: "Heures planifiées",
  CONTRAT: "Heures / mois",
  CONTRAT_REPLI: "Heures contrat (repli)",
};
