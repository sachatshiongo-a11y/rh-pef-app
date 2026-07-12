// Catégorie professionnelle de l'emploi (classification du Code du travail RDC). Distincte de la
// catégorie opérationnelle (BRIGADE / BACKOFFICE) utilisée pour le planning.

export const CATEGORIES_PRO = [
  { value: "MANOEUVRE", label: "Manœuvres (simples et spécialisés)", desc: "Travaux élémentaires ne nécessitant aucune formation ou adaptation préalable (agent d'entretien, gardien)." },
  { value: "OUVRIER_QUALIFIE", label: "Ouvriers / Travailleurs qualifiés", desc: "Travaux nécessitant une qualification professionnelle ou une formation spécifique de base." },
  { value: "EMPLOYE", label: "Employés", desc: "Travaux administratifs (employés de bureau, secrétaires), souvent répartis par échelons (1er, 2e)." },
  { value: "AGENT_MAITRISE", label: "Agents de maîtrise et Techniciens", desc: "Connaissances techniques supérieures, encadrement et supervision d'autres travailleurs." },
  { value: "CADRE", label: "Cadres de direction", desc: "Hautes responsabilités de direction, de conception ou de gestion." },
] as const;

export type CategoriePro = (typeof CATEGORIES_PRO)[number]["value"];

/** Libellé lisible d'une catégorie professionnelle (null si non définie). */
export function labelCategoriePro(v: string | null | undefined): string | null {
  return CATEGORIES_PRO.find((c) => c.value === v)?.label ?? null;
}
