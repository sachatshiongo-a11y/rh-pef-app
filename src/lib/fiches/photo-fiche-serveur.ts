import "server-only";

import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import {
  cheminDepuisUrlPrivee, cheminPhotoFiche, detecterTypeImage, envoyerPhoto, extensionImage,
  identifiantsSupabase, supprimerPhoto, urlPriveeDe, verifierBucketPhotos,
} from "@/lib/fiches/photo-storage";

// Envoi de la photo d'une fiche technique : UNE chaîne pour la page de la fiche (`envoyerPhotoFiche`,
// qui remplace) et pour l'import des fiches du bar (`envoyerPhotoFicheImport`, qui n'ajoute une
// photo qu'à une fiche qui n'en a pas). Bucket privé, contenu réel vérifié (jamais le type MIME
// annoncé), 5 Mo au plus, URL privée en base, journalisé.

export const TAILLE_MAX_PHOTO_OCTETS = 5 * 1024 * 1024; // 5 Mo — même plafond que les photos d'employé

export type ResultatPhoto = { statut: "ENVOYEE" | "DEJA_UNE_PHOTO"; photoUrl: string | null };

/**
 * `siAbsente` : ne touche JAMAIS une fiche qui a déjà une photo — vérifié avant l'envoi, puis à
 * l'écriture (`photoUrl IS NULL`) : si une photo est apparue entre-temps, l'objet envoyé est
 * retiré du bucket et la fiche garde la sienne.
 * Sinon (page de la fiche) : remplace ; l'ancienne photo est retirée APRÈS que la base pointe vers
 * la nouvelle — si le nettoyage échoue, c'est l'ancienne qui devient orpheline, jamais la fiche
 * qui se retrouve sans photo valide.
 */
export async function televerserPhotoFiche(ficheId: string, formData: FormData, options: { siAbsente: boolean; userId: string }): Promise<ResultatPhoto> {
  const fiche = await prisma.ficheTechnique.findUnique({ where: { id: ficheId }, select: { id: true, photoUrl: true } });
  if (!fiche) throw new Error("Fiche introuvable.");
  if (options.siAbsente && fiche.photoUrl) return { statut: "DEJA_UNE_PHOTO", photoUrl: fiche.photoUrl };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Aucune photo reçue.");
  if (file.size > TAILLE_MAX_PHOTO_OCTETS) throw new Error("Photo trop lourde (max 5 Mo).");

  const bytes = Buffer.from(await file.arrayBuffer());
  const typeReel = detecterTypeImage(bytes);
  if (!typeReel) throw new Error("Le fichier envoyé n'est pas une image PNG, JPG ou WEBP reconnue.");

  const ids = identifiantsSupabase();
  await verifierBucketPhotos(ids);

  const chemin = cheminPhotoFiche(ficheId, extensionImage(typeReel));
  await envoyerPhoto(ids, chemin, bytes, typeReel);
  const urlPrivee = urlPriveeDe(chemin);

  if (options.siAbsente) {
    const { count } = await prisma.ficheTechnique.updateMany({ where: { id: ficheId, photoUrl: null }, data: { photoUrl: urlPrivee } });
    if (count !== 1) {
      await supprimerPhoto(ids, chemin);
      const actuelle = await prisma.ficheTechnique.findUnique({ where: { id: ficheId }, select: { photoUrl: true } });
      return { statut: "DEJA_UNE_PHOTO", photoUrl: actuelle?.photoUrl ?? null };
    }
  } else {
    await prisma.ficheTechnique.update({ where: { id: ficheId }, data: { photoUrl: urlPrivee } });
    const ancienChemin = cheminDepuisUrlPrivee(fiche.photoUrl);
    if (ancienChemin && ancienChemin !== chemin) await supprimerPhoto(ids, ancienChemin);
  }

  await journaliser(prisma, {
    entite: "FicheTechnique",
    entiteId: ficheId,
    champ: "photo",
    ancienneValeur: fiche.photoUrl,
    nouvelleValeur: urlPrivee,
    userId: options.userId,
  });
  return { statut: "ENVOYEE", photoUrl: urlPrivee };
}
