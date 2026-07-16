"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { changerMotDePasseAdmin } from "@/lib/securite-connexion";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { creerNotification } from "@/lib/notifications";
import { formulaireLisible } from "@/lib/erreur-formulaire";

/** Garde commune à l'espace salarié : feature active + rôle EMPLOYE + fiche liée. Renvoie l'employeeId. */
async function exigerSalarie(): Promise<{ userId: string; employeeId: string }> {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || user.role !== "EMPLOYE") throw new Error("Accès refusé.");
  const compte = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });
  if (!compte?.employeeId) throw new Error("Compte non relié à une fiche employé.");
  return { userId: user.id, employeeId: compte.employeeId };
}

/** Le salarié définit son nouveau mot de passe (fin du mot de passe temporaire). */
export async function changerMonMotDePasse(formData: FormData) {
  return formulaireLisible("/espace/mot-de-passe", async () => {
    const user = await verifySession();
    if (user.role !== "EMPLOYE") throw new Error("Accès refusé.");
    const mdp = String(formData.get("motDePasse") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");
    if (mdp.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");
    if (mdp !== confirmation) throw new Error("Les deux mots de passe ne correspondent pas.");

    await changerMotDePasseAdmin(user.id, mdp);
    await prisma.user.update({ where: { id: user.id }, data: { motDePasseTemporaire: false } });
    redirect("/espace");
  });
}

/** Le salarié dépose SA propre demande de congé (toujours EN_ATTENTE de validation Direction). */
export async function demanderMonConge(formData: FormData) {
  return formulaireLisible("/espace/conges", async () => {
    const { userId, employeeId } = await exigerSalarie();
    const type = String(formData.get("type") ?? "").trim();
    const dateDebut = new Date(String(formData.get("dateDebut") ?? ""));
    const dateFin = new Date(String(formData.get("dateFin") ?? ""));
    const motif = String(formData.get("motif") ?? "").trim() || null;
    if (!type || Number.isNaN(dateDebut.getTime()) || Number.isNaN(dateFin.getTime())) throw new Error("Type et dates requis.");
    if (dateFin < dateDebut) throw new Error("La date de fin doit être après la date de début.");

    const feries = await prisma.jourFerie.findMany({ where: { date: { gte: dateDebut, lte: dateFin } }, select: { date: true } });
    const nbJours = calculerJoursOuvrables(dateDebut, dateFin, feries.map((f) => f.date));
    if (nbJours <= 0) throw new Error("La période ne contient aucun jour ouvrable (dimanches et fériés exclus).");

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    const demande = await prisma.leaveRequest.create({
      data: { employeeId, type, dateDebut, dateFin, nbJours, motif, statut: "EN_ATTENTE" },
    });
    await creerNotification({
      type: "CONGE",
      message: `Demande de congé (${type}) — ${emp?.nom ?? "salarié"}, ${nbJours} j.`,
      lien: "/a-valider",
      refId: demande.id,
    });

    revalidatePath("/espace/conges");
    revalidatePath("/a-valider");
    revalidatePath("/conges");
    revalidatePath("/", "layout");
    // Marqueur de succès (le formulaire relit ce paramètre).
    redirect("/espace/conges?envoye=1");
  });
}
