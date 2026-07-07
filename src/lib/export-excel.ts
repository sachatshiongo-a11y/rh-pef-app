import "server-only";

/**
 * Lignes d'en-tête communes à tous les exports Excel : identité société, période (mois) et date
 * d'export. À placer avant les colonnes de données dans `aoa_to_sheet([...enteteExcel(...), ...])`.
 */
export function enteteExcel(titre: string, periode: string): string[][] {
  return [
    [`Pâtes en Folie (TOLYA SARL) — ${titre}`],
    [`Période : ${periode}`],
    [`Édité le : ${new Date().toLocaleDateString("fr-FR")}`],
    [],
  ];
}
