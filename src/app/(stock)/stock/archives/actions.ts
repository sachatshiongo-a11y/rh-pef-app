"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

/** Supprime TOUS les rapports générés archivés (Direction uniquement). Les documents se re-générant à la demande. */
export async function supprimerTousRapports() {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const { count } = await prisma.rapport.deleteMany({});
  await journaliser(prisma, { entite: "Rapport", entiteId: "tous", champ: "suppression groupée", nouvelleValeur: `${count} rapport(s)`, userId: user.id });
  revalidatePath("/stock/archives");
}
