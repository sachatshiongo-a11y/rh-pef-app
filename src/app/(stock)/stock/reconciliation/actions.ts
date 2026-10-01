"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { verifySession, requireModule } from "@/lib/auth";
import { lireComptesSaisis } from "@/lib/validations-stock/comptage";
import { appliquerOuDemanderComptage, type ResultatComptage } from "@/lib/validations-stock/demandes";

/**
 * Applique un comptage physique : ajuste le stock au réel, ARCHIVE la fiche (SessionComptage),
 * et exige une explication pour tout écart > 10 %. Si des écarts dépassent le seuil, notifie la
 * Direction et le responsable stock.
 *
 * Hors Direction, un comptage qui produit au moins un ajustement n'écrit RIEN : il devient une
 * réconciliation « à valider » (voir `appliquerOuDemanderComptage`). Un comptage sans écart, lui,
 * est archivé directement — il n'y a rien à ajuster.
 */
export const appliquerComptage = actionLisible(async (formData: FormData): Promise<ResultatComptage> => {
  const user = await verifySession();
  requireModule(user, "stock");
  const r = await appliquerOuDemanderComptage(user, lireComptesSaisis(formData));
  revalidatePath("/stock/reconciliation");
  revalidatePath("/stock/archives");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/a-valider");
  revalidatePath("/stock");
  return r;
});
