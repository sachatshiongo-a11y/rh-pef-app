"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerDirectionPourSupprimer } from "@/lib/suppression-direction";
import { identifiantsSupabase, supprimerPhoto, cheminDepuisUrlPrivee } from "@/lib/fiches/photo-storage";
import { televerserPhotoFiche } from "@/lib/fiches/photo-fiche-serveur";

// Photo d'une fiche technique (plat) : bucket privé, patron identique à l'upload de photo
// d'employé (src/app/(app)/employes/photo-actions.ts), voir src/lib/fiches/photo-storage.ts.

const ENTITE = "FicheTechnique";

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/**
 * Envoie (ou remplace) la photo d'une fiche technique — chaîne partagée avec l'import des fiches du
 * bar (`televerserPhotoFiche`, src/lib/fiches/photo-fiche-serveur.ts).
 */
export const envoyerPhotoFiche = actionLisible(async (ficheId: string, formData: FormData) => {
  const user = await garde();
  await televerserPhotoFiche(ficheId, formData, { siAbsente: false, userId: user.id });
  revalidatePath(`/stock/fiches/${ficheId}`);
  revalidatePath("/stock/fiches");
});

/** Retire la photo d'une fiche technique : colonne remise à `null` ET objet supprimé du bucket.
 *  Direction seulement (règle de Sacha, 2026-10-01). La REMPLACER (`envoyerPhotoFiche`) reste ouvert. */
export const supprimerPhotoFiche = actionLisible(async (ficheId: string) => {
  const user = await garde();
  exigerDirectionPourSupprimer(user);
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
