"use server";

// Les actions du scan de l'affiche QR — minces : session → employé lié au compte → module
// `lib/pointage-scan`. L'employé n'est JAMAIS lu dans l'entrée : il vient du compte connecté (le
// pointage est toujours pour soi). `actionLisible` : les refus métier restent lisibles en prod.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { employeLieAuCompte } from "@/lib/pointage-presences";
import { confirmerDepartScan, enregistrerScan, type ResultatScan } from "@/lib/pointage-scan";
import type { PositionScan } from "@/lib/pointage-qr";

/** Scanner l'affiche : arrivée, départ à confirmer, double scan trop rapide, ou journée complète. */
export const scannerAffiche = actionLisible(
  async (entree: { code: string; position: PositionScan; confirmerDepartRapide?: boolean }): Promise<ResultatScan> => {
    const user = await verifySession();
    const employeeId = await employeLieAuCompte(prisma, user.id);
    const r = await enregistrerScan(prisma, {
      employeeId,
      userId: user.id,
      code: entree.code,
      position: entree.position,
      confirmerDepartRapide: entree.confirmerDepartRapide === true,
    });
    revalidatePath("/pointer");
    revalidatePath("/espace/pointer");
    revalidatePath("/pointer/suivi");
    return r;
  },
);

/**
 * Confirmer le départ scanné en saisissant la pause → la journée est close et alimente la paie
 * (sauf congé approuvé ce jour : `presencesEcrites` faux, l'écran le dit).
 */
export const confirmerDepart = actionLisible(
  async (entree: { scanId: string; pauseMinutes: number }): Promise<{ heureFin: string; heures: number; presencesEcrites: boolean }> => {
    const user = await verifySession();
    const employeeId = await employeLieAuCompte(prisma, user.id);
    const r = await confirmerDepartScan(prisma, { employeeId, scanId: String(entree.scanId), pauseMinutes: entree.pauseMinutes });
    revalidatePath("/pointer");
    revalidatePath("/espace/pointer");
    revalidatePath("/pointer/suivi");
    revalidatePath("/presences");
    revalidatePath("/heures-supp");
    revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
    return r;
  },
);
