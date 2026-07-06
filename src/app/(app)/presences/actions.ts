"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";
import { dureeShift, pariteSemaine } from "../planning/creneaux";
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

  // Un jour de présence (P) pré-remplit les heures supp. avec la DURÉE DU SHIFT du jour (modèle
  // hebdo de l'employé) — ex. Caisse 12h pour Rachel, Admin 3,5h pour Aimée. À défaut de modèle,
  // on retombe sur l'horaire contractuel (heures/jour). Ajustable ensuite dans la grille.
  if (code === "P") {
    const dejaSaisi = await prisma.overtimeEntry.findUnique({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
    });
    if (!dejaSaisi) {
      const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
      let heures = Number(employee.heuresParJour);
      const dObj = new Date(date);
      const jour = dObj.getUTCDay();
      // Modèle du jour : couche de la parité (semaine A/B), sinon couche « chaque semaine ».
      const modeles = await prisma.planningModele.findMany({
        where: { employeeId, jour, semaine: { in: [pariteSemaine(dObj), 0] } },
      });
      const modele =
        modeles.find((m) => m.semaine === pariteSemaine(dObj)) ?? modeles.find((m) => m.semaine === 0);
      if (modele) {
        const shift = await prisma.shift.findUnique({ where: { id: modele.shiftId } });
        if (shift) {
          const d = dureeShift({
            heureDebut: shift.heureDebut,
            heureFin: shift.heureFin,
            dureeHeures: shift.dureeHeures != null ? Number(shift.dureeHeures) : null,
          });
          if (d > 0) heures = d;
        }
      }
      await prisma.overtimeEntry.create({
        data: { employeeId, date: new Date(date), heuresTravaillees: heures },
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