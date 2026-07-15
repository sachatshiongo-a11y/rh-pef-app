"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { snapshotActuel } from "@/lib/cloture-inventaire";
import { formulaireLisible } from "@/lib/erreur-formulaire";

async function gardeDirection() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  return user;
}

/** Clôture un mois de stock : fige l'inventaire du moment et verrouille les mouvements datés dedans. */
export async function cloturerMoisStock(annee: number, mois: number) {
  await formulaireLisible("/stock/parametres", async () => {
  const user = await gardeDirection();
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) throw new Error("Période invalide.");
  // Instantané figé : quantité + valeur de chaque article à la date de clôture.
  const snapshot = await snapshotActuel();
  await prisma.clotureStock.upsert({
    where: { annee_mois: { annee, mois } },
    update: { snapshot },
    create: { annee, mois, creeParId: user.id, snapshot },
  });
  await journaliser(prisma, { entite: "ClotureStock", entiteId: `${annee}-${mois}`, champ: "cloture", nouvelleValeur: `clôturé — stock ${snapshot.valeurTotaleUSD.toFixed(2)} $`, userId: user.id });
  revalidatePath("/stock/parametres");
  });
}

/** Rouvre un mois de stock clôturé. */
export async function rouvrirMoisStock(annee: number, mois: number) {
  const user = await gardeDirection();
  await prisma.clotureStock.deleteMany({ where: { annee, mois } });
  await journaliser(prisma, { entite: "ClotureStock", entiteId: `${annee}-${mois}`, champ: "cloture", nouvelleValeur: "rouvert", userId: user.id });
  revalidatePath("/stock/parametres");
}
