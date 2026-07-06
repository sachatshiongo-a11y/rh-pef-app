// Génération de matricule selon la logique existante :
//   - Brigade    : <initiales prénom+nom><NN>-PEF   (ex. Caprice Bokole → CB28-PEF)
//   - Backoffice : BO<NN>-PEF                        (ex. BO01-PEF)
// NN = prochain numéro libre de la CATÉGORIE (les brigades et le back-office ont des séries
// distinctes). Le matricule complet est garanti unique.

export function initialesMatricule(nom: string): string {
  const parts = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const a = parts[0]?.[0] ?? "X";
  const b = (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1]) ?? "X";
  return (a + b).toUpperCase().replace(/[^A-Z]/g, "X");
}

/**
 * Génère un matricule pour un employé.
 * @param matriculesMemeCategorie matricules déjà pris dans la MÊME catégorie (pour le numéro et l'unicité).
 */
export function genererMatricule(
  nom: string,
  categorie: "BRIGADE" | "BACKOFFICE",
  matriculesMemeCategorie: string[]
): string {
  const prefixe = categorie === "BACKOFFICE" ? "BO" : initialesMatricule(nom);
  let maxNum = 0;
  for (const m of matriculesMemeCategorie) {
    const mm = /(\d+)-PEF$/i.exec(m ?? "");
    if (mm) maxNum = Math.max(maxNum, Number(mm[1]));
  }
  const pris = new Set(matriculesMemeCategorie);
  let n = maxNum + 1;
  let mat = `${prefixe}${String(n).padStart(2, "0")}-PEF`;
  while (pris.has(mat)) {
    n++;
    mat = `${prefixe}${String(n).padStart(2, "0")}-PEF`;
  }
  return mat;
}
