"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";
import { joursEnConge } from "@/lib/conges-couverture";

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

/** Saisie en lot (collage / actions groupées). Les jours couverts par un congé APPROUVÉ ne
 * reçoivent pas d'heures (entrée ignorée et renvoyée à l'appelant) ; l'effacement reste permis. */
export async function saisirHeuresEnLot(
  entrees: { employeeId: string; date: string; heures: string }[]
): Promise<{ ignores: { employeeId: string; date: string }[] }> {
  const user: CurrentUser = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const enConge = await joursEnConge(entrees);
  const ignores: { employeeId: string; date: string }[] = [];
  for (const { employeeId, date, heures } of entrees) {
    const valeur = Number(heures);
    if (heures !== "" && valeur > 0 && enConge.has(`${employeeId}|${date}`)) { ignores.push({ employeeId, date }); continue; }
    await appliquerHeures(employeeId, date, heures);
  }

  revalidatePath("/heures-supp");
  revalidatePath("/employes");
  return { ignores };
}
