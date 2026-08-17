"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { journaliser } from "@/lib/audit";

/** Accorde un prêt au personnel : montant + retenue mensuelle (déduite auto de la paie). Admin/Manager. */
export async function creerPret(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const montant = Number(String(formData.get("montantUSD") ?? "").replace(",", "."));
    const retenue = Number(String(formData.get("retenueMensuelleUSD") ?? "").replace(",", "."));
    const motif = String(formData.get("motif") ?? "").trim() || null;
    if (!Number.isFinite(montant) || montant <= 0) throw new Error("Montant du prêt invalide.");
    if (!Number.isFinite(retenue) || retenue <= 0) throw new Error("Retenue mensuelle invalide.");
    if (retenue > montant) throw new Error("La retenue mensuelle ne peut pas dépasser le montant du prêt.");

    await prisma.pretPersonnel.create({
      data: { employeeId, montantUSD: montant, retenueMensuelleUSD: retenue, motif, creeParId: user.id },
    });
    await journaliser(prisma, {
      entite: "PretPersonnel", entiteId: employeeId, champ: "création",
      nouvelleValeur: `${montant} USD, retenue ${retenue}/mois`, userId: user.id,
    });
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/paie");
  });
}

/** Annule un prêt (les retenues déjà appliquées restent ; plus de retenue future). Admin. */
export async function annulerPret(employeeId: string, pretId: string) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);
    await prisma.pretPersonnel.update({ where: { id: pretId }, data: { statut: "ANNULE" } });
    await journaliser(prisma, { entite: "PretPersonnel", entiteId: pretId, champ: "statut", nouvelleValeur: "ANNULE", userId: user.id });
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/paie");
  });
}
