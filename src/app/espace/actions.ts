"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { changerMotDePasseAdmin } from "@/lib/securite-connexion";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { creerNotification } from "@/lib/notifications";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { televerserFichierEmploye } from "@/lib/fichiers-employe";

/** Marque comme lues MES notifications (cloche salarié) — scopé à mon compte uniquement. */
export async function marquerMesNotificationsLues() {
  const user = await verifySession();
  if (!estSalarie(user)) throw new Error("Accès refusé.");
  await prisma.notification.updateMany({ where: { domaine: "SALARIE", destinataireUserId: user.id, lu: false }, data: { lu: true } });
  revalidatePath("/espace", "layout");
}

/** Supprime UNE de mes notifications (vérifie qu'elle m'appartient). */
export async function supprimerMaNotification(id: string) {
  const user = await verifySession();
  if (!estSalarie(user)) throw new Error("Accès refusé.");
  await prisma.notification.deleteMany({ where: { id, domaine: "SALARIE", destinataireUserId: user.id } });
  revalidatePath("/espace", "layout");
}

/** Garde commune à l'espace salarié : feature active + compte salarié (EMPLOYE/STOCK) + fiche liée. */
async function exigerSalarie(): Promise<{ userId: string; employeeId: string }> {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user)) throw new Error("Accès refusé.");
  if (!user.employeeId) throw new Error("Compte non relié à une fiche employé.");
  return { userId: user.id, employeeId: user.employeeId };
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

/** Le salarié demande un acompte sur salaire (EN_ATTENTE ; notifie la Direction). */
export async function demanderMonAcompte(formData: FormData) {
  return formulaireLisible("/espace/paie", async () => {
    const { employeeId } = await exigerSalarie();
    const montantUSD = Number(String(formData.get("montantUSD") ?? "").replace(",", "."));
    if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Indiquez un montant d'acompte valide (en $).");
    const motif = String(formData.get("motif") ?? "").trim() || null;

    const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
    const mois = config?.moisCourant ?? new Date().getMonth() + 1;
    const annee = config?.anneeCourante ?? new Date().getFullYear();

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    const acompte = await prisma.acompteSalaire.create({
      data: { employeeId, montantUSD, mois, annee, motif, statut: "EN_ATTENTE" },
    });
    await creerNotification({
      type: "ACOMPTE",
      message: `Demande d'acompte — ${emp?.nom ?? "salarié"}, ${montantUSD.toFixed(2)} $.`,
      lien: "/a-valider",
      refId: acompte.id,
    });

    revalidatePath("/espace/paie");
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");
    redirect("/espace/paie?acompte=1");
  });
}

/** Le salarié envoie un certificat médical (justificatif) → document rattaché à sa fiche + notif Direction. */
export async function envoyerMonCertificat(formData: FormData) {
  return formulaireLisible("/espace/documents", async () => {
    const { userId, employeeId } = await exigerSalarie();
    const fichier = formData.get("certificat");
    if (!(fichier instanceof File) || fichier.size === 0) throw new Error("Choisissez un fichier (PDF ou image).");
    const note = String(formData.get("note") ?? "").trim();

    const fichierUrl = await televerserFichierEmploye(employeeId, fichier, "certificats");
    await prisma.documentEmploye.create({
      data: {
        employeeId,
        type: "CERTIFICAT_MEDICAL",
        nom: note || `Certificat médical du ${new Date().toLocaleDateString("fr-FR")}`,
        fichierUrl,
        dateEmission: new Date(),
      },
    });
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    await creerNotification({
      type: "AUTRE",
      message: `Certificat médical reçu — ${emp?.nom ?? "salarié"}.`,
      lien: `/employes/${employeeId}?tab=dossier`,
      refId: `certif:${userId}:${Date.now()}`,
    });

    revalidatePath("/espace/documents");
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/", "layout");
    redirect("/espace/documents?certif=1");
  });
}
