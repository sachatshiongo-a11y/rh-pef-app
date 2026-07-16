"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { changerMotDePasseAdmin } from "@/lib/securite-connexion";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { creerNotification, notifierSalarie, compteSalarieDe, supprimerNotificationsPour } from "@/lib/notifications";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { televerserFichierEmploye } from "@/lib/fichiers-employe";
import { finaliserEchangeSiComplet } from "@/lib/echange-creneau";

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

/** Le salarié demande à changer son shift sur un jour donné (EN_ATTENTE ; notifie la Direction). */
export async function demanderChangementShift(formData: FormData) {
  return formulaireLisible("/espace/echanges", async () => {
    const { employeeId } = await exigerSalarie();
    const dateIso = String(formData.get("date") ?? "").trim();
    const shiftDemandeId = String(formData.get("shiftDemandeId") ?? "").trim();
    const motif = String(formData.get("motif") ?? "").trim() || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !shiftDemandeId) throw new Error("Choisissez un jour et un shift souhaité.");
    const date = new Date(dateIso + "T00:00:00.000Z");

    // Le shift souhaité doit exister et être actif ; le créneau actuel est lu du planning.
    const [shift, creneau, dejaEnAttente] = await Promise.all([
      prisma.shift.findFirst({ where: { id: shiftDemandeId, actif: true }, select: { id: true, nom: true } }),
      prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId, date } }, select: { shiftId: true } }),
      prisma.demandeChangementShift.findFirst({ where: { employeeId, date, statut: "EN_ATTENTE" }, select: { id: true } }),
    ]);
    if (!shift) throw new Error("Shift souhaité introuvable.");
    if (dejaEnAttente) throw new Error("Vous avez déjà une demande en attente pour ce jour.");
    if (creneau?.shiftId === shiftDemandeId) throw new Error("C'est déjà votre shift ce jour-là.");

    const dem = await prisma.demandeChangementShift.create({
      data: { employeeId, date, shiftActuelId: creneau?.shiftId ?? null, shiftDemandeId, motif },
    });
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    await creerNotification({
      type: "AUTRE",
      message: `Demande de changement de shift — ${emp?.nom ?? "salarié"}, ${date.toLocaleDateString("fr-FR", { timeZone: "UTC" })} → ${shift.nom}.`,
      lien: "/a-valider",
      refId: dem.id,
    });

    revalidatePath("/espace/echanges");
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");
    redirect("/espace/echanges?echange=1");
  });
}

/** Le salarié annule sa demande de changement de shift simple (tant qu'elle est en attente). */
export async function annulerChangement(id: string) {
  const user = await verifySession();
  if (!estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");
  const d = await prisma.demandeChangementShift.findUnique({ where: { id }, select: { employeeId: true, statut: true } });
  if (!d || d.employeeId !== user.employeeId || d.statut !== "EN_ATTENTE") return;
  await prisma.demandeChangementShift.delete({ where: { id } });
  await supprimerNotificationsPour(id);
  revalidatePath("/espace/echanges");
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
}

/** Le salarié propose un ÉCHANGE de créneau avec un collègue (double validation collègue + Direction). */
export async function demanderEchange(formData: FormData) {
  return formulaireLisible("/espace/echanges", async () => {
    const { employeeId } = await exigerSalarie();
    const dateIso = String(formData.get("date") ?? "").trim(); // mon créneau (jour cédé)
    const cible = String(formData.get("cible") ?? "").trim();   // "collegueId__dateIso" (créneau visé)
    const motif = String(formData.get("motif") ?? "").trim() || null;
    const [collegueId, collegueDateIso] = cible.split("__");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !collegueId || !/^\d{4}-\d{2}-\d{2}$/.test(collegueDateIso ?? ""))
      throw new Error("Choisissez votre créneau et le créneau à échanger.");
    if (collegueId === employeeId) throw new Error("Choisissez le créneau d'un collègue.");
    const maDate = new Date(dateIso + "T00:00:00.000Z");
    const saDate = new Date(collegueDateIso + "T00:00:00.000Z");

    const [monCreneau, sonCreneau, dejaEnAttente] = await Promise.all([
      prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId, date: maDate } }, select: { shiftId: true } }),
      prisma.planningCreneau.findUnique({ where: { employeeId_date: { employeeId: collegueId, date: saDate } }, select: { shiftId: true } }),
      prisma.echangeCreneau.findFirst({ where: { demandeurId: employeeId, demandeurDate: maDate, statut: "EN_ATTENTE" }, select: { id: true } }),
    ]);
    if (!monCreneau) throw new Error("Vous n'avez pas de service publié ce jour-là.");
    if (!sonCreneau) throw new Error("Ce collègue n'a plus ce service.");
    if (dejaEnAttente) throw new Error("Vous avez déjà une demande d'échange en attente pour ce jour.");

    const [moi, collegue] = await Promise.all([
      prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true, poste: true } }),
      prisma.employee.findUnique({ where: { id: collegueId }, select: { nom: true, poste: true } }),
    ]);
    // Le collègue doit pouvoir COUVRIR mon poste (même poste ou polyvalence posteSource→posteCible).
    if (moi && collegue && collegue.poste !== moi.poste) {
      const couvre = await prisma.polyvalencePoste.findFirst({ where: { posteSource: collegue.poste, posteCible: moi.poste }, select: { id: true } });
      if (!couvre) throw new Error("Ce collègue n'a pas un poste pouvant couvrir le vôtre.");
    }
    const ech = await prisma.echangeCreneau.create({
      data: {
        demandeurId: employeeId, demandeurDate: maDate, demandeurShiftId: monCreneau.shiftId,
        collegueId, collegueDate: saDate, collegueShiftId: sonCreneau.shiftId, motif,
      },
    });

    // Notifier le COLLÈGUE (cloche + push) et la Direction (inbox À valider).
    const uCollegue = await compteSalarieDe(collegueId);
    if (uCollegue) await notifierSalarie(uCollegue, {
      type: "PLANNING",
      message: `${moi?.nom ?? "Un collègue"} vous propose un échange de shift (${maDate.toLocaleDateString("fr-FR", { timeZone: "UTC" })}). À accepter ou refuser.`,
      lien: "/espace/echanges",
      refId: ech.id,
    });
    await creerNotification({
      type: "AUTRE",
      message: `Échange de shift proposé — ${moi?.nom ?? "salarié"} ↔ ${collegue?.nom ?? "collègue"}.`,
      lien: "/a-valider",
      refId: ech.id,
    });

    revalidatePath("/espace/echanges");
    revalidatePath("/a-valider");
    revalidatePath("/", "layout");
    redirect("/espace/echanges?propose=1");
  });
}

/** Le COLLÈGUE concerné accepte ou refuse l'échange. Accepter peut finaliser (si Direction OK). */
export async function repondreEchange(id: string, accepte: boolean) {
  const user = await verifySession();
  if (!estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE" || e.collegueId !== user.employeeId) return;

  if (!accepte) {
    await prisma.echangeCreneau.update({ where: { id }, data: { reponseCollegue: "REFUSE", statut: "REFUSE" } });
    await supprimerNotificationsPour(id);
    const uA = await compteSalarieDe(e.demandeurId);
    if (uA) await notifierSalarie(uA, { type: "PLANNING", message: "Votre proposition d'échange de shift a été refusée par le collègue.", lien: "/espace/echanges", refId: `${id}:rep` });
  } else {
    await prisma.echangeCreneau.update({ where: { id }, data: { reponseCollegue: "ACCEPTE" } });
    const fait = await finaliserEchangeSiComplet(id);
    if (!fait) {
      // En attente de la Direction : on la relance.
      const noms = await prisma.employee.findMany({ where: { id: { in: [e.demandeurId, e.collegueId] } }, select: { nom: true } });
      await creerNotification({ type: "AUTRE", message: `Échange de shift accepté par le collègue — ${noms.map((n) => n.nom).join(" ↔ ")}. À valider.`, lien: "/a-valider", refId: id });
    }
  }
  revalidatePath("/espace/echanges");
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
}

/** Le DEMANDEUR annule sa proposition tant qu'elle est en attente. */
export async function annulerEchange(id: string) {
  const user = await verifySession();
  if (!estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE" || e.demandeurId !== user.employeeId) return;
  await prisma.echangeCreneau.update({ where: { id }, data: { statut: "ANNULE" } });
  await supprimerNotificationsPour(id);
  const uB = await compteSalarieDe(e.collegueId);
  if (uB) await notifierSalarie(uB, { type: "PLANNING", message: "Une proposition d'échange de shift a été annulée.", lien: "/espace/echanges", refId: `${id}:ann` });
  revalidatePath("/espace/echanges");
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
}

/** Le salarié accepte numériquement son contrat (« Lu et approuvé », horodaté). Notifie la Direction. */
export async function accepterMonContrat(id: string) {
  const user = await verifySession();
  if (!estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");
  const c = await prisma.contrat.findUnique({ where: { id }, select: { employeeId: true, accepteLe: true, type: true } });
  if (!c || c.employeeId !== user.employeeId || c.accepteLe) return; // déjà accepté ou pas le mien
  await prisma.contrat.update({ where: { id }, data: { accepteLe: new Date() } });
  const emp = await prisma.employee.findUnique({ where: { id: user.employeeId }, select: { nom: true } });
  await creerNotification({
    type: "AUTRE",
    message: `${emp?.nom ?? "Un salarié"} a accepté son contrat (${c.type}).`,
    lien: `/employes/${user.employeeId}?tab=contrats`,
    refId: `contrat:${id}:accept`,
  });
  revalidatePath("/espace/documents");
  revalidatePath(`/employes/${user.employeeId}`);
  revalidatePath("/", "layout");
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
