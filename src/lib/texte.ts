// Normalisation de texte partagée (avant : copiée dans ~15 fichiers, avec de légères variantes
// qui divergeaient à chaque correction). Base commune des rapprochements flous.

/** Retire les accents (décomposition NFD + suppression des diacritiques). */
export const sansAccents = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Minuscule sans accents — pour les comparaisons « souples ». */
export const normTexte = (s: string) => sansAccents(s).toLowerCase();

/** Clé alphanumérique stricte (minuscule, sans accents, sans ponctuation ni espaces). */
export const cleAlnum = (s: string) => normTexte(s).replace(/[^a-z0-9]/g, "");

/** Similarité de Jaccard entre deux ensembles de mots (0..1). */
export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

/**
 * Les missions / activités d'une fiche de poste sont saisies en LISTE (une ligne = un élément) :
 * c'est la forme structurée, rendue en TABLEAU sur la fiche de poste PDF. Là où une rédaction
 * suivie est attendue (contrat, carte « Poste » de la fiche employé), on convertit cette liste en
 * énumération lisible — d'où cet utilitaire partagé.
 */
export function listeEnProse(texte: string | null | undefined): string {
  const lignes = (texte ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[•\-–*]\s*/, "").trim())
    .filter(Boolean);
  if (lignes.length === 0) return "";
  if (lignes.length === 1) return lignes[0];
  return lignes.map((l) => l.replace(/[.;]+\s*$/, "")).join(" ; ") + ".";
}
