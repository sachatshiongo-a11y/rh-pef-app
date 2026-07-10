"use server";

import { revalidatePath } from "next/cache";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { analyserInventaire, appliquerInventaire, annulerImport, type PreviewInventaire } from "@/lib/import-inventaire";

async function gardeDirection() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // les imports sont réservés à la Direction
  return user;
}

/** Analyse le classeur téléversé et renvoie l'aperçu (aucune écriture). */
export async function analyserInventaireAction(formData: FormData): Promise<PreviewInventaire> {
  await gardeDirection();
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) throw new Error("Ajoutez le fichier d'inventaire (.xlsx).");
  return analyserInventaire(await file.arrayBuffer());
}

/** Applique l'inventaire et crée un import réversible. */
export async function appliquerInventaireAction(formData: FormData): Promise<{ batchId: string; resume: PreviewInventaire["resume"] }> {
  const user = await gardeDirection();
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) throw new Error("Fichier manquant.");
  const libelle = String(formData.get("libelle") ?? "").trim() || file.name.replace(/\.xlsx$/i, "");
  const res = await appliquerInventaire(await file.arrayBuffer(), libelle, user.id);
  revalidatePath("/stock/imports");
  revalidatePath("/stock/catalogue", "layout");
  return res;
}

/** Annule un import (supprime les créations, restaure les mises à jour). */
export async function annulerImportAction(batchId: string): Promise<void> {
  await gardeDirection();
  await annulerImport(batchId);
  revalidatePath("/stock/imports");
  revalidatePath("/stock/catalogue", "layout");
}
