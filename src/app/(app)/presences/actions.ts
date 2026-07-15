"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";
import { joursEnConge, joursDeReposSelonModele } from "@/lib/conges-couverture";

// Un congé (C ou S) ne se pose JAMAIS sur un dimanche ou un jour férié : ces jours ne sont pas
// décomptés des congés (même règle que calculerJoursOuvrables). Garde partagée unitaire/lot.
const estDimancheIso = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
async function feriesDans(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const tri = [...dates].sort();
  const rows = await prisma.jourFerie.findMany({ where: { date: { gte: new Date(`${tri[0]}T00:00:00Z`), lte: new Date(`${tri[tri.length - 1]}T00:00:00Z`) } }, select: { date: true } });
  return new Set(rows.map((r) => new Date(r.date).toISOString().slice(0, 10)));
}
const estConge = (code: string) => code === "C" || code === "S";
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

  // Un jour de présence (P) pré-remplit les heures avec, par ordre de priorité :
  //  1. le CRÉNEAU PLANIFIÉ du jour (onglet Planning) — la réalité de la semaine prime ;
  //  2. sinon le shift du MODÈLE HEBDO de l'employé (rôle habituel du jour) ;
  //  3. sinon l'horaire contractuel (heures/jour). Ajustable ensuite dans la grille.
  if (code === "P") {
    const dejaSaisi = await prisma.overtimeEntry.findUnique({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
    });
    if (!dejaSaisi) {
      const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
      let heures = Number(employee.heuresParJour);
      const dObj = new Date(date);
      const jour = dObj.getUTCDay();

      // 1. Planning du jour (un Repos/Congé planifié n'a pas d'heures → on passe au modèle).
      const creneau = await prisma.planningCreneau.findUnique({
        where: { employeeId_date: { employeeId, date: dObj } },
        include: { shift: true },
      });
      let dureePlanifiee = 0;
      if (creneau) {
        dureePlanifiee = dureeShift({
          heureDebut: creneau.shift.heureDebut,
          heureFin: creneau.shift.heureFin,
          dureeHeures: creneau.shift.dureeHeures != null ? Number(creneau.shift.dureeHeures) : null,
        });
      }
      if (dureePlanifiee > 0) {
        heures = dureePlanifiee;
      } else {
        // 2. Modèle du jour : couche de la parité (semaine A/B), sinon couche « chaque semaine ».
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
      }
      await prisma.overtimeEntry.create({
        data: { employeeId, date: new Date(date), heuresTravaillees: heures },
      });
    }
  }
}

export async function saisirPresence(employeeId: string, date: string, code: AttendanceCode | ""): Promise<{ ignore?: string }> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  if (code !== "" && estConge(code)) {
    const feries = await feriesDans([date]);
    if (estDimancheIso(date) || feries.has(date)) {
      return { ignore: "Un congé (C/S) ne se pose pas sur un dimanche ou un jour férié — ces jours ne sont pas décomptés des congés." };
    }
  }
  await appliquerPresence(employeeId, date, code);

  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
  return {};
}

/** Saisie en lot (collage / actions groupées). Sont ignorés et renvoyés à l'appelant :
 *  - « P » sur un jour couvert par un congé APPROUVÉ ;
 *  - « P » sur un jour de REPOS selon le modèle hebdo (ex. le samedi d'Aimée — la saisie
 *    unitaire reste libre pour un travail exceptionnel) ;
 *  - « C »/« S » sur un dimanche ou un jour férié (jamais décomptés des congés). */
export async function saisirPresencesEnLot(
  entrees: { employeeId: string; date: string; code: AttendanceCode | "" }[]
): Promise<{ ignores: { employeeId: string; date: string }[] }> {
  const user: CurrentUser = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const [enConge, feries, repos] = await Promise.all([
    joursEnConge(entrees),
    feriesDans(entrees.map((e) => e.date)),
    joursDeReposSelonModele(entrees),
  ]);
  const ignores: { employeeId: string; date: string }[] = [];
  for (const { employeeId, date, code } of entrees) {
    if (code === "P" && enConge.has(`${employeeId}|${date}`)) { ignores.push({ employeeId, date }); continue; }
    if (code === "P" && repos.has(`${employeeId}|${date}`)) { ignores.push({ employeeId, date }); continue; }
    if (code !== "" && estConge(code) && (estDimancheIso(date) || feries.has(date))) { ignores.push({ employeeId, date }); continue; }
    await appliquerPresence(employeeId, date, code);
  }

  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
  return { ignores };
}