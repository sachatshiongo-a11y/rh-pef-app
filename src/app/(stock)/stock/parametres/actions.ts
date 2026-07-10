"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

async function gardeDirection() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  return user;
}

/** Clôture un mois de stock : plus aucun mouvement daté dedans ne pourra être créé/supprimé. */
export async function cloturerMoisStock(annee: number, mois: number) {
  const user = await gardeDirection();
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) throw new Error("Période invalide.");
  await prisma.clotureStock.upsert({ where: { annee_mois: { annee, mois } }, update: {}, create: { annee, mois, creeParId: user.id } });
  await journaliser(prisma, { entite: "ClotureStock", entiteId: `${annee}-${mois}`, champ: "cloture", nouvelleValeur: "clôturé", userId: user.id });
  revalidatePath("/stock/parametres");
}

/** Rouvre un mois de stock clôturé. */
export async function rouvrirMoisStock(annee: number, mois: number) {
  const user = await gardeDirection();
  await prisma.clotureStock.deleteMany({ where: { annee, mois } });
  await journaliser(prisma, { entite: "ClotureStock", entiteId: `${annee}-${mois}`, champ: "cloture", nouvelleValeur: "rouvert", userId: user.id });
  revalidatePath("/stock/parametres");
}
