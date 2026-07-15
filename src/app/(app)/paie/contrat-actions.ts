"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import type { TypeContrat } from "@prisma/client";
import { formulaireLisible } from "@/lib/erreur-formulaire";

function revalider(employeeId: string) {
  revalidatePath("/paie");
  revalidatePath("/employes");
  revalidatePath(`/employes/${employeeId}`);
}

/** Transforme un contrat (fin de période d'essai) : change le type et solde la période d'essai. */
export async function transformerContrat(id: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const type = String(formData.get("type")) as TypeContrat;
  const dateFinStr = String(formData.get("dateFin") ?? "").trim();

  const contrat = await prisma.contrat.findUnique({ where: { id } });
  if (!contrat) return;

  await prisma.contrat.update({
    where: { id },
    data: {
      type,
      finPeriodeEssai: null, // période d'essai transformée
      dateFin: type === "CDI" ? null : dateFinStr ? new Date(dateFinStr) : contrat.dateFin,
    },
  });
  await journaliser(prisma, {
    entite: "Contrat",
    entiteId: contrat.employeeId,
    champ: "transformation",
    nouvelleValeur: `→ ${type}`,
    userId: user.id,
  });
  revalider(contrat.employeeId);
}

/** Rompt un contrat (statut RÉSILIÉ) — sortie de l'employé. */
export async function rompreContrat(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const contrat = await prisma.contrat.findUnique({ where: { id } });
  if (!contrat) return;
  await prisma.contrat.update({ where: { id }, data: { statut: "RESILIE" } });
  await journaliser(prisma, {
    entite: "Contrat",
    entiteId: contrat.employeeId,
    champ: "statut",
    nouvelleValeur: "RESILIE",
    userId: user.id,
  });
  revalider(contrat.employeeId);
}

/** Prolonge un contrat (nouvelle date de fin). */
export async function prolongerContrat(id: string, formData: FormData) {
  await formulaireLisible("/paie", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);
    const dateFinStr = String(formData.get("dateFin") ?? "").trim();
    if (!dateFinStr) throw new Error("Nouvelle date de fin requise.");
    const contrat = await prisma.contrat.findUnique({ where: { id } });
    if (!contrat) return;
    await prisma.contrat.update({ where: { id }, data: { dateFin: new Date(dateFinStr) } });
    await journaliser(prisma, {
      entite: "Contrat",
      entiteId: contrat.employeeId,
      champ: "prolongation",
      nouvelleValeur: new Date(dateFinStr).toLocaleDateString("fr-FR"),
      userId: user.id,
    });
    revalider(contrat.employeeId);

  });
}
