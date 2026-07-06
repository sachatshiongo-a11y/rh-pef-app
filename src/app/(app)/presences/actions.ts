"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";
import type { AttendanceCode } from "@prisma/client";

async function appliquerPresence(
  employeeId: string,
  date: string,
  code: AttendanceCode | ""
) {
  if (code === "") {
    await prisma.attendance.deleteMany({ where: { employeeId, date: new Date(date) } });
    return;
  }

  await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: new Date(date) } },
    update: { code },
    create: { employeeId, date: new Date(date), code },
  });

  // Un jour de présence (P) pré-remplit les heures supp. avec l'horaire contractuel de
  // l'employé, pour n'avoir plus qu'à ajuster en cas d'heures sup. réelles (ou pas).
  if (code === "P") {
    const dejaSaisi = await prisma.overtimeEntry.findUnique({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
    });
    if (!dejaSaisi) {
      const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
      await prisma.overtimeEntry.create({
        data: { employeeId, date: new Date(date), heuresTravaillees: employee.heuresParJour },
      });
    }
  }
}

export async function saisirPresence(employeeId: string, date: string, code: AttendanceCode | "") {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  await appliquerPresence(employeeId, date, code);

  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
}

/** Saisie en lot (collage type tableur) : un seul aller-retour réseau pour tout un bloc collé. */
export async function saisirPresencesEnLot(
  entrees: { employeeId: string; date: string; code: AttendanceCode | "" }[]
) {
  const user: CurrentUser = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  for (const { employeeId, date, code } of entrees) {
    await appliquerPresence(employeeId, date, code);
  }

  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
}