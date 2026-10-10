"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { snapshotActuel } from "@/lib/cloture-inventaire";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { exigerMoisClorable, messageDejaCloture } from "@/lib/cloture-stock-regles";
import { moisCourantKinshasa } from "@/lib/heure-kinshasa";
import { Prisma } from "@prisma/client";

async function gardeDirection() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  return user;
}

/**
 * Clôture un mois de stock : fige l'inventaire DU MOMENT (l'instantané dit de quand il date) et verrouille
 * les mouvements datés dedans. Refusé : le mois en cours et les mois futurs (le mois doit être terminé), et
 * un mois déjà clôturé (rouvrez-le d'abord : l'instantané n'est jamais réécrit en silence).
 */
export async function cloturerMoisStock(annee: number, mois: number) {
  await formulaireLisible("/parametres", async () => {
    const user = await gardeDirection();
    exigerMoisClorable(annee, mois, moisCourantKinshasa());
    if (await prisma.clotureStock.findUnique({ where: { annee_mois: { annee, mois } }, select: { id: true } })) throw new Error(messageDejaCloture(annee, mois));
    // Instantané figé : quantité + valeur de chaque article à la date de clôture.
    const snapshot = await snapshotActuel();
    try {
      await prisma.clotureStock.create({ data: { annee, mois, creeParId: user.id, snapshot } });
    } catch (e) {
      // Course : une autre clôture du même mois vient d'aboutir (unicité année/mois).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new Error(messageDejaCloture(annee, mois));
      throw e;
    }
    await journaliser(prisma, { entite: "ClotureStock", entiteId: `${annee}-${mois}`, champ: "cloture", nouvelleValeur: `clôturé — stock ${snapshot.valeurTotaleUSD.toFixed(2)} $${snapshot.nbSansPrix > 0 ? ` (partiel : ${snapshot.nbSansPrix} sans prix)` : ""}`, userId: user.id });
    revalidatePath("/parametres");
  });
}

/** Rouvre un mois de stock clôturé (les erreurs reviennent par la page : action de formulaire). */
export async function rouvrirMoisStock(annee: number, mois: number) {
  await formulaireLisible("/parametres", async () => {
    const user = await gardeDirection();
    const n = await prisma.clotureStock.deleteMany({ where: { annee, mois } });
    if (n.count === 0) throw new Error("Ce mois n'est pas clôturé (peut-être déjà rouvert) : rien n'a changé.");
    await journaliser(prisma, { entite: "ClotureStock", entiteId: `${annee}-${mois}`, champ: "cloture", nouvelleValeur: "rouvert", userId: user.id });
    revalidatePath("/parametres");
  });
}
