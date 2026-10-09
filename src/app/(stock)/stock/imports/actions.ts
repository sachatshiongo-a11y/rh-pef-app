"use server";

import { revalidatePath } from "next/cache";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { analyserInventaire, appliquerInventaire, annulerImport, type PreviewInventaire } from "@/lib/import-inventaire";
import { analyserFactures, appliquerFactures, type PreviewFactures } from "@/lib/import-factures";
import { analyserMouvements, appliquerMouvements, type PreviewMouvements } from "@/lib/import-mouvements";
import { detecterDoublons, retirerDoublons, type ApercuDoublons } from "@/lib/doublons-imports";
import { sortiesSontLivraisons, CHAMP_SORTIES_LIVRAISON } from "@/lib/motif-sorties-import";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";

// Toutes les actions sont enrobées par actionLisible : les erreurs métier (fichier manquant,
// mois clôturé, rien à importer…) reviennent au client comme { erreur } LISIBLE — en prod,
// Next masque le message des erreurs jetées.

const AUJ = () => jourCourantKinshasaISO();

async function gardeDirection() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // les imports sont réservés à la Direction
  return user;
}

/** Analyse le classeur téléversé et renvoie l'aperçu (aucune écriture). */
export const analyserInventaireAction = actionLisible(async (formData: FormData): Promise<PreviewInventaire> => {
  await gardeDirection();
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) throw new Error("Ajoutez le fichier d'inventaire (.xlsx).");
  return analyserInventaire(await file.arrayBuffer());
});

/** Applique l'inventaire et crée un import réversible. */
export const appliquerInventaireAction = actionLisible(
  async (formData: FormData): Promise<{ batchId: string; resume: PreviewInventaire["resume"] }> => {
    const user = await gardeDirection();
    const file = formData.get("fichier");
    if (!(file instanceof File) || file.size === 0) throw new Error("Fichier manquant.");
    const libelle = String(formData.get("libelle") ?? "").trim() || file.name.replace(/\.xlsx$/i, "");
    let choixArticles: Record<string, string> = {};
    try { const brut = JSON.parse(String(formData.get("choixArticles") ?? "{}")); if (brut && typeof brut === "object" && !Array.isArray(brut)) choixArticles = Object.fromEntries(Object.entries(brut).filter(([, v]) => typeof v === "string")) as Record<string, string>; } catch { /* illisible : aucun choix, le serveur redemande */ }
    const res = await appliquerInventaire(await file.arrayBuffer(), libelle, user.id, {
      sortiesLivraisonRestaurant: sortiesSontLivraisons(formData.get(CHAMP_SORTIES_LIVRAISON)),
      choixArticles, // anti-doublon : « Utiliser … » / « Créer quand même » décidés dans l'aperçu
    });
    revalidatePath("/stock/imports");
    revalidatePath("/stock/catalogue", "layout");
    return res;
  }
);

/** Analyse le(s) classeur(s) de factures et renvoie l'aperçu (aucune écriture). */
export const analyserFacturesAction = actionLisible(async (formData: FormData): Promise<PreviewFactures> => {
  await gardeDirection();
  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) throw new Error("Ajoutez au moins un classeur de factures (.xlsx).");
  return analyserFactures(fichiers);
});

/** Applique l'import de factures et crée un import réversible. */
export const appliquerFacturesAction = actionLisible(
  async (formData: FormData): Promise<{ batchId: string; resume: PreviewFactures["resume"] }> => {
    const user = await gardeDirection();
    const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
    if (fichiers.length === 0) throw new Error("Fichier(s) manquant(s).");
    const libelle = String(formData.get("libelle") ?? "").trim() || `Factures ${jourKinshasa(new Date())}`;
    const res = await appliquerFactures(fichiers, libelle, user.id);
    revalidatePath("/stock/imports");
    revalidatePath("/stock/factures");
    return res;
  }
);

/** Analyse un CSV d'entrées/sorties et renvoie l'aperçu (aucune écriture). */
export const analyserMouvementsAction = actionLisible(async (formData: FormData): Promise<PreviewMouvements> => {
  await gardeDirection();
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) throw new Error("Ajoutez un fichier CSV d'entrées/sorties.");
  // La date par défaut date les lignes sans date : l'aperçu peut alors repérer leurs jumeaux.
  const dateDefaut = String(formData.get("dateDefaut") ?? "").trim() || undefined;
  return analyserMouvements(await file.text(), dateDefaut);
});

/** Applique l'import de mouvements (crée les mouvements, ajuste le stock) — réversible.
 * `lignes` (JSON de numéros de lignes CSV, optionnel) : seules ces lignes de l'aperçu sont
 * importées (sélection par cases + période côté client). */
export const appliquerMouvementsAction = actionLisible(
  async (formData: FormData): Promise<{ batchId: string; resume: PreviewMouvements["resume"] }> => {
    const user = await gardeDirection();
    const file = formData.get("fichier");
    if (!(file instanceof File) || file.size === 0) throw new Error("Fichier manquant.");
    const libelle = String(formData.get("libelle") ?? "").trim() || `Mouvements ${jourKinshasa(new Date())}`;
    const dateDefaut = String(formData.get("dateDefaut") ?? "").trim() || AUJ();
    let lignesChoisies: number[] | undefined;
    const brut = String(formData.get("lignes") ?? "").trim();
    if (brut) {
      try {
        const arr: unknown = JSON.parse(brut);
        if (Array.isArray(arr)) lignesChoisies = arr.filter((n): n is number => Number.isInteger(n));
      } catch {
        /* sélection illisible → import complet (comportement historique) */
      }
    }
    const res = await appliquerMouvements(await file.text(), libelle, dateDefaut, user.id, lignesChoisies, {
      sortiesLivraisonRestaurant: sortiesSontLivraisons(formData.get(CHAMP_SORTIES_LIVRAISON)),
    });
    revalidatePath("/stock/imports");
    revalidatePath("/stock/mouvements");
    revalidatePath("/stock/catalogue", "layout");
    return res;
  }
);

/** Annule un import (supprime les créations, restaure les mises à jour). */
export const annulerImportAction = actionLisible(async (batchId: string): Promise<{ stocksLaisses: string[] }> => {
  const user = await gardeDirection();
  const r = await annulerImport(batchId, user.id);
  revalidatePath("/stock/imports");
  revalidatePath("/stock/catalogue", "layout");
  return r; // stocks dont la valeur d'avant était négative : laissés tels quels, nommés
});

const listeIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);

/** Aperçu des mouvements en double entre un import d'inventaire et des imports de mouvements (aucune écriture). */
export const detecterDoublonsAction = actionLisible(async (inventaireId: string, mouvementsIds: string[]): Promise<ApercuDoublons> => {
  await gardeDirection();
  return detecterDoublons(String(inventaireId ?? ""), listeIds(mouvementsIds));
});

/** Retire les copies en double de l'import d'inventaire (garde celles de l'import de mouvements). Stock inchangé. */
export const retirerDoublonsAction = actionLisible(
  async (inventaireId: string, mouvementsIds: string[], ids: string[]): Promise<{ retires: number; message: string }> => {
    const user = await gardeDirection();
    const r = await retirerDoublons(String(inventaireId ?? ""), listeIds(mouvementsIds), listeIds(ids), user.id);
    // L'historique retiré alimente plusieurs écrans (mouvements, consommation, conso journalière).
    revalidatePath("/stock", "layout");
    return r;
  }
);
