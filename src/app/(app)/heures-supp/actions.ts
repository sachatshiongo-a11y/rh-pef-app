"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";

async function appliquerHeures(employeeId: string, date: string, heures: string) {
  const valeur = Number(heures);

  if (!heures || Number.isNaN(valeur) || valeur === 0) {
    await prisma.overtimeEntry.deleteMany({ where: { employeeId, date: new Date(date) } });
  } else {
    await prisma.overtimeEntry.upsert({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
      update: { heuresTravaillees: valeur },
      create: { employeeId, date: new Date(date), heuresTravaillees: valeur },
    });
  }
}

export async function saisirHeures(employeeId: string, date: string, heures: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  await appliquerHeures(employeeId, date, heures);

  revalidatePath("/heures-supp");
  revalidatePath("/employes");
}

/** Saisie en lot (collage type tableur) : un seul aller-retour réseau pour tout un bloc collé. */
export async function saisirHeuresEnLot(
  entrees: { employeeId: string; date: string; heures: string }[]
) {
  const user: CurrentUser = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  for (const { employeeId, date, heures } of entrees) {
    await appliquerHeures(employeeId, date, heures);
  }

  revalidatePath("/heures-supp");
  revalidatePath("/employes");
}
