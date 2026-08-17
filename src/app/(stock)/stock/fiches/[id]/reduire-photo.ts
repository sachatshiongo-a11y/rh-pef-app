// Réduction d'une photo de plat AVANT envoi, côté navigateur.
//
// Les photos importées du classeur sont déjà compressées (~70-100 Ko). Une photo prise à la main
// depuis un téléphone ne l'est pas — et l'action serveur (`envoyerPhotoFiche`) ne redimensionne
// rien : elle accepte tel quel n'importe quoi jusqu'à 5 Mo. Sur le réseau de Kinshasa, un envoi de
// plusieurs Mo se voit. On réduit donc ici, avant même d'appeler l'action : redimensionnement à une
// largeur raisonnable pour un dressage lisible sur téléphone, puis compression JPEG par paliers de
// qualité décroissants jusqu'à repasser sous la cible.

/** Sous ce poids, une photo n'a pas besoin d'être retouchée — inutile de dégrader une image déjà légère. */
export const POIDS_CIBLE_OCTETS = 300 * 1024; // 300 Ko — large marge au-dessus des 70-100 Ko du classeur

/** Un plat n'a pas besoin de plus pour rester lisible en référence de dressage sur téléphone. */
export const COTE_MAX_PIXELS = 1600;

/** Paliers de qualité JPEG essayés dans l'ordre, du plus fidèle au plus compact. */
const PALIERS_QUALITE = [0.82, 0.7, 0.58, 0.45] as const;

export type ResultatReduction = {
  fichier: File;
  /** Message à afficher à l'utilisateur — `null` si la photo est passée telle quelle. */
  note: string | null;
};

/** Vrai si le fichier est déjà assez léger pour partir sans retouche. */
export function dejaLeger(tailleOctets: number): boolean {
  return tailleOctets <= POIDS_CIBLE_OCTETS;
}

/** Poids lisible en français : « 210 Ko » sous 1 Mo, « 4,8 Mo » au-delà. */
export function formatPoids(octets: number): string {
  const ko = octets / 1024;
  if (ko < 1024) return `${Math.round(ko)} Ko`;
  return `${(ko / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

function versBlob(canvas: HTMLCanvasElement, qualite: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", qualite));
}

/**
 * Redimensionne et compresse une image. Peut échouer sur un navigateur trop ancien (pas de
 * `createImageBitmap` ou de contexte 2D) — l'appelant doit alors se rabattre sur le fichier
 * d'origine et laisser l'action serveur trancher (max 5 Mo).
 */
export async function reduireImage(fichier: File): Promise<ResultatReduction> {
  const bitmap = await createImageBitmap(fichier);
  try {
    const ratio = Math.min(1, COTE_MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
    const largeur = Math.max(1, Math.round(bitmap.width * ratio));
    const hauteur = Math.max(1, Math.round(bitmap.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte de dessin 2D indisponible.");
    ctx.drawImage(bitmap, 0, 0, largeur, hauteur);

    let meilleur: Blob | null = null;
    for (const qualite of PALIERS_QUALITE) {
      const blob = await versBlob(canvas, qualite);
      if (!blob) continue;
      meilleur = blob;
      if (blob.size <= POIDS_CIBLE_OCTETS) break;
    }
    if (!meilleur) throw new Error("Échec de la compression.");

    const nom = fichier.name.replace(/\.[^.]+$/, "") + ".jpg";
    const reduit = new File([meilleur], nom, { type: "image/jpeg" });
    // Le redimensionnement peut suffire même sans passer sous la cible (grande photo déjà nette) :
    // on informe dans tous les cas de la réduction réelle plutôt que de promettre un chiffre non tenu.
    const note = `Photo réduite de ${formatPoids(fichier.size)} à ${formatPoids(reduit.size)} avant envoi.`;
    return { fichier: reduit, note };
  } finally {
    bitmap.close?.();
  }
}
