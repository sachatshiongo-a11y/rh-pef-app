"use server";

// Les actions du scan de l'affiche QR — minces : session → employé lié au compte → module
// `lib/pointage-scan` / `lib/pointage-annulation`. L'employé n'est JAMAIS lu dans l'entrée : il
// vient du compte connecté (le pointage est toujours pour soi). `actionLisible` : les refus
// métier restent lisibles en prod.
//
// Ces actions ne partent QUE du script de la page, après son chargement (jamais d'une requête
// GET) : un aperçu de lien ou un préchargement de `/scan?c=…` n'exécute pas ce script et ne
// pointe donc rien (décision de la Direction du 2026-09-29, « scanner = pointer »).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { employeLieAuCompte } from "@/lib/pointage-presences";
import { enregistrerScan, saisirPauseScan, type ResultatScan } from "@/lib/pointage-scan";
import { annulerScan } from "@/lib/pointage-annulation";
import type { PositionScan } from "@/lib/pointage-qr";

function revaliderPointage() {
  revalidatePath("/pointer");
  revalidatePath("/espace/pointer");
  revalidatePath("/pointer/suivi");
  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
}

/**
 * Scanner l'affiche : arrivée ; départ (la journée est close, pause par défaut 30 min) ; scan
 * répété sous 10 min (rien de nouveau) ; ou journée complète.
 */
export const scannerAffiche = actionLisible(
  async (entree: { code: string; position: PositionScan }): Promise<ResultatScan> => {
    const user = await verifySession();
    const employeeId = await employeLieAuCompte(prisma, user.id);
    const r = await enregistrerScan(prisma, {
      employeeId,
      userId: user.id,
      code: entree.code,
      position: entree.position,
    });
    revaliderPointage();
    return r;
  },
);

/**
 * La pause du jour, saisie par le salarié APRÈS son départ (facultatif) : elle remplace la pause
 * par défaut, et les heures aux présences suivent (sauf congé approuvé : `presencesEcrites` faux).
 */
export const saisirMaPause = actionLisible(
  async (entree: {
    scanId: string;
    pauseMinutes: number;
  }): Promise<{ heureFin: string; heures: number; presencesEcrites: boolean; pauseMinutes: number }> => {
    const user = await verifySession();
    const employeeId = await employeLieAuCompte(prisma, user.id);
    const r = await saisirPauseScan(prisma, {
      employeeId,
      userId: user.id,
      scanId: String(entree.scanId),
      pauseMinutes: entree.pauseMinutes,
    });
    revaliderPointage();
    return r;
  },
);

/**
 * « Annuler ce pointage » : le scan que CE salarié vient de faire, dans les 5 minutes. Journalisé ;
 * ni le scan ni le pointage ne sont effacés (le scan est marqué annulé et ignoré ensuite).
 */
export const annulerPointage = actionLisible(
  async (entree: { scanId: string }): Promise<{ moment: "ARRIVEE" | "DEPART"; heure: string }> => {
    const user = await verifySession();
    const employeeId = await employeLieAuCompte(prisma, user.id);
    const r = await annulerScan(prisma, { employeeId, userId: user.id, scanId: String(entree.scanId) });
    revaliderPointage();
    return r;
  },
);
