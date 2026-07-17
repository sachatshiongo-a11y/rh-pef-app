"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";

/** Génère la checklist d'intégration d'un employé depuis le modèle (si elle n'existe pas encore). */
export async function genererOnboarding(employeeId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const dejaLa = await prisma.tacheOnboarding.count({ where: { employeeId } });
  if (dejaLa === 0) {
    const modele = await prisma.modeleTacheOnboarding.findMany({ orderBy: { ordre: "asc" } });
    if (modele.length > 0) {
      await prisma.tacheOnboarding.createMany({
        data: modele.map((m) => ({ employeeId, libelle: m.libelle, ordre: m.ordre })),
      });
    }
  }
  revalidatePath(`/employes/${employeeId}`);
}

/** Coche / décoche une tâche d'intégration. */
export async function basculerTacheOnboarding(employeeId: string, tacheId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const t = await prisma.tacheOnboarding.findUnique({ where: { id: tacheId } });
  if (!t || t.employeeId !== employeeId) return;
  await prisma.tacheOnboarding.update({
    where: { id: tacheId },
    data: { fait: !t.fait, faitLe: !t.fait ? new Date() : null },
  });
  revalidatePath(`/employes/${employeeId}`);
}
