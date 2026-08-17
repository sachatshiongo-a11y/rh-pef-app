"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import {
  detecterTypeImage,
  extensionImage,
  identifiantsSupabase,
  verifierBucketPhotos,
  envoyerPhoto,
  supprimerPhoto,
  urlPriveeDe,
  cheminDepuisUrlPrivee,
  cheminPhotoFiche,
} from "@/lib/fiches/photo-storage";

// Photo d'une fiche technique (plat) : bucket privé, patron identique à l'upload de photo
// d'employé (src/app/(app)/employes/photo-actions.ts), voir src/lib/fiches/photo-storage.ts.

const ENTITE = "FicheTechnique";
const TAILLE_MAX_OCTETS = 5 * 1024 * 1024; // 5 Mo — même plafond que les photos d'employé

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/**
 * Envoie (ou remplace) la photo d'une fiche technique. L'ancienne photo, si elle existe, est
 * retirée du bucket APRÈS que la base pointe vers la nouvelle : si le nettoyage échoue, c'est
 * l'ancienne photo qui devient orpheline, jamais la fiche qui se retrouve sans photo valide.
 */
export const envoyerPhotoFiche = actionLisible(async (ficheId: string, formData: FormData) => {
  const user = await garde();
  const fiche = await prisma.ficheTechnique.findUnique({ where: { id: ficheId }, select: { id: true, photoUrl: true } });
  if (!fiche) throw new Error("Fiche introuvable.");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Aucune photo reçue.");
  if (file.size > TAILLE_MAX_OCTETS) throw new Error("Photo trop lourde (max 5 Mo).");

  const bytes = Buffer.from(await file.arrayBuffer());
  const typeReel = detecterTypeImage(bytes);
  if (!typeReel) throw new Error("Le fichier envoyé n'est pas une image PNG, JPG ou WEBP reconnue.");

  const ids = identifiantsSupabase();
  await verifierBucketPhotos(ids);

  const chemin = cheminPhotoFiche(ficheId, extensionImage(typeReel));
  await envoyerPhoto(ids, chemin, bytes, typeReel);

  const ancienChemin = cheminDepuisUrlPrivee(fiche.photoUrl);
  const urlPrivee = urlPriveeDe(chemin);
  await prisma.ficheTechnique.update({ where: { id: ficheId }, data: { photoUrl: urlPrivee } });

  if (ancienChemin && ancienChemin !== chemin) await supprimerPhoto(ids, ancienChemin);

  await journaliser(prisma, {
    entite: ENTITE,
    entiteId: ficheId,
    champ: "photo",
    ancienneValeur: fiche.photoUrl,
    nouvelleValeur: urlPrivee,
    userId: user.id,
  });
  revalidatePath(`/stock/fiches/${ficheId}`);
  revalidatePath("/stock/fiches");
});

/** Retire la photo d'une fiche technique : colonne remise à `null` ET objet supprimé du bucket. */
export const supprimerPhotoFiche = actionLisible(async (ficheId: string) => {
  const user = await garde();
  const fiche = await prisma.ficheTechnique.findUnique({ where: { id: ficheId }, select: { id: true, photoUrl: true } });
  if (!fiche) throw new Error("Fiche introuvable.");
  if (!fiche.photoUrl) return;

  const chemin = cheminDepuisUrlPrivee(fiche.photoUrl);
  await prisma.ficheTechnique.update({ where: { id: ficheId }, data: { photoUrl: null } });
  if (chemin) await supprimerPhoto(identifiantsSupabase(), chemin);

  await journaliser(prisma, {
    entite: ENTITE,
    entiteId: ficheId,
    champ: "photo_retiree",
    ancienneValeur: fiche.photoUrl,
    userId: user.id,
  });
  revalidatePath(`/stock/fiches/${ficheId}`);
  revalidatePath("/stock/fiches");
});
