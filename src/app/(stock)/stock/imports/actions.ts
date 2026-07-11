"use server";

import { revalidatePath } from "next/cache";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { analyserInventaire, appliquerInventaire, annulerImport, type PreviewInventaire } from "@/lib/import-inventaire";
import { analyserFactures, appliquerFactures, type PreviewFactures } from "@/lib/import-factures";
import { analyserMouvements, appliquerMouvements, type PreviewMouvements } from "@/lib/import-mouvements";

const AUJ = () => new Date().toISOString().slice(0, 10);

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

/** Analyse le(s) classeur(s) de factures et renvoie l'aperçu (aucune écriture). */
export async function analyserFacturesAction(formData: FormData): Promise<PreviewFactures> {
  await gardeDirection();
  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) throw new Error("Ajoutez au moins un classeur de factures (.xlsx).");
  return analyserFactures(fichiers);
}

/** Applique l'import de factures et crée un import réversible. */
export async function appliquerFacturesAction(formData: FormData): Promise<{ batchId: string; resume: PreviewFactures["resume"] }> {
  const user = await gardeDirection();
  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) throw new Error("Fichier(s) manquant(s).");
  const libelle = String(formData.get("libelle") ?? "").trim() || `Factures ${new Date().toLocaleDateString("fr-FR")}`;
  const res = await appliquerFactures(fichiers, libelle, user.id);
  revalidatePath("/stock/imports");
  revalidatePath("/stock/factures");
  return res;
}

/** Analyse un CSV d'entrées/sorties et renvoie l'aperçu (aucune écriture). */
export async function analyserMouvementsAction(formData: FormData): Promise<PreviewMouvements> {
  await gardeDirection();
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) throw new Error("Ajoutez un fichier CSV d'entrées/sorties.");
  return analyserMouvements(await file.text());
}

/** Applique l'import de mouvements (crée les mouvements, ajuste le stock) — réversible. */
export async function appliquerMouvementsAction(formData: FormData): Promise<{ batchId: string; resume: PreviewMouvements["resume"] }> {
  const user = await gardeDirection();
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) throw new Error("Fichier manquant.");
  const libelle = String(formData.get("libelle") ?? "").trim() || `Mouvements ${new Date().toLocaleDateString("fr-FR")}`;
  const dateDefaut = String(formData.get("dateDefaut") ?? "").trim() || AUJ();
  const res = await appliquerMouvements(await file.text(), libelle, dateDefaut, user.id);
  revalidatePath("/stock/imports");
  revalidatePath("/stock/mouvements");
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
