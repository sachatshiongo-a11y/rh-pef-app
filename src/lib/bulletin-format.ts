/**
 * Libellés PARTAGÉS des rubriques de bulletin, pour que les trois rendus (PDF, aperçu de la fiche
 * employé, aperçu des cartes mobile de la paie) utilisent exactement la même terminologie.
 * Importable côté serveur comme client (simples constantes).
 */
export const LBL_BULLETIN = {
  base: "Salaire de base",
  maladie: "Indemnité maladie (2/3)",
  hs: "Heures supplémentaires",
  transport: "Frais de transport",
  brut: "Salaire brut imposable",
  cnss: "CNSS (part salarié)",
  ipr: "IPR (impôt sur le revenu)",
  acompte: "Acompte sur salaire",
  alloc: "Allocation familiale",
  fraisMedicaux: "Frais médicaux",
  net: "Salaire net à payer",
} as const;
