"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { poserCodesConge, retirerCodesConge } from "@/lib/conges-presences";

function revaliderConges() {
  revalidatePath("/conges");
  revalidatePath("/presences");
  revalidatePath("/heures-supp");
  revalidatePath("/a-valider");
  revalidatePath("/employes");
  revalidatePath("/", "layout");
  revalidatePath("/dashboard");
}

export async function demanderConge(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const employeeId = String(formData.get("employeeId"));
  const type = String(formData.get("type"));
  const dateDebut = new Date(String(formData.get("dateDebut")));
  const dateFin = new Date(String(formData.get("dateFin")));
  // Jours ouvrables : dimanches ET jours fériés exclus du décompte.
  const feries = await prisma.jourFerie.findMany({ where: { date: { gte: dateDebut, lte: dateFin } }, select: { date: true } });
  const nbJours = calculerJoursOuvrables(dateDebut, dateFin, feries.map((f) => f.date));
  const motif = String(formData.get("motif") ?? "").trim() || null;
  const remplacantId = String(formData.get("remplacantId") ?? "").trim() || null;

  // La Direction n'a pas à valider ses propres demandes : approuvée d'office (comme les BC).
  const autoValide = user.role === "ADMIN";
  const demande = await prisma.leaveRequest.create({
    data: { employeeId, type, dateDebut, dateFin, nbJours, motif, remplacantId, statut: autoValide ? "APPROUVE" : "EN_ATTENTE", ...(autoValide ? { approuveParId: user.id } : {}) },
  });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
  // Notification TOUJOURS émise (choix client : trace visible même en auto-validation).
  if (!autoValide) {
    await creerNotification({
      type: "CONGE",
      message: `Nouvelle demande de congé (${type}) — ${emp?.nom ?? "employé"}, ${nbJours} j.`,
      lien: "/a-valider",
      refId: demande.id,
    });
  } else {
    await journaliser(prisma, { entite: "LeaveRequest", entiteId: demande.id, champ: "statut", nouvelleValeur: "APPROUVE (auto — Direction)", userId: user.id });
    // Synchro grille Présences : les jours ouvrables du congé reçoivent leur code (C ou S).
    await poserCodesConge(employeeId, dateDebut, dateFin, type);
    await creerNotification({
      type: "CONGE",
      message: `Congé (${type}) approuvé — ${emp?.nom ?? "employé"}, ${nbJours} j.`,
      lien: "/conges",
      refId: demande.id,
    });
  }

  revalidatePath("/conges");
  revalidatePath("/employes");
  revalidatePath("/", "layout");
}

/** Seuls les comptes Admin (Directrice, Sacha) peuvent autoriser ou refuser une demande. */
export async function approuverConge(leaveRequestId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const demande = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId } });
  await prisma.leaveRequest.update({
    where: { id: leaveRequestId },
    data: { statut: "APPROUVE", approuveParId: user.id },
  });
  // Synchro grille Présences : jours ouvrables du congé → code C/S, heures retirées.
  await poserCodesConge(demande.employeeId, new Date(demande.dateDebut), new Date(demande.dateFin), demande.type);
  await journaliser(prisma, {
    entite: "LeaveRequest",
    entiteId: leaveRequestId,
    champ: "statut",
    nouvelleValeur: "APPROUVE",
    userId: user.id,
  });
  await supprimerNotificationsPour(leaveRequestId);

  revaliderConges();
}

export async function refuserConge(leaveRequestId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const demande = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId } });
  await prisma.leaveRequest.update({
    where: { id: leaveRequestId },
    data: { statut: "REFUSE", approuveParId: user.id },
  });
  // Un congé auparavant approuvé avait posé ses codes sur la grille : on les retire.
  if (demande.statut === "APPROUVE") await retirerCodesConge(demande.employeeId, new Date(demande.dateDebut), new Date(demande.dateFin));
  await journaliser(prisma, {
    entite: "LeaveRequest",
    entiteId: leaveRequestId,
    champ: "statut",
    nouvelleValeur: "REFUSE",
    userId: user.id,
  });
  await supprimerNotificationsPour(leaveRequestId);

  revaliderConges();
}

/**
 * Supprime UNE demande de congé (A2) : la retire de la liste (≠ la refuser, qui la garde en
 * historique avec le statut REFUSE). La suppression est tracée au journal d'audit (qui, quand,
 * quelle demande), même si la demande n'apparaît plus. Réservé à l'Admin.
 */
export async function supprimerConge(leaveRequestId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const demande = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: { employee: { select: { nom: true, matricule: true } } },
  });
  if (!demande) return;

  const resume = `${demande.type} de ${demande.employee.nom} (${demande.employee.matricule}) du ${new Date(
    demande.dateDebut
  ).toLocaleDateString("fr-FR")} au ${new Date(demande.dateFin).toLocaleDateString("fr-FR")} — statut ${demande.statut}`;

  if (demande.statut === "APPROUVE") await retirerCodesConge(demande.employeeId, new Date(demande.dateDebut), new Date(demande.dateFin));
  await supprimerNotificationsPour(leaveRequestId);
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.delete({ where: { id: leaveRequestId } });
    await journaliser(tx, {
      entite: "LeaveRequest",
      entiteId: leaveRequestId,
      champ: "suppression",
      ancienneValeur: resume,
      userId: user.id,
    });
  });

  revaliderConges();
}

/** ACTION GROUPÉE : approuve plusieurs demandes en attente d'un coup. */
export async function approuverCongesEnLot(ids: string[]): Promise<number> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  let n = 0;
  for (const id of ids) {
    const d = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!d || d.statut !== "EN_ATTENTE") continue;
    await prisma.leaveRequest.update({
      where: { id },
      data: { statut: "APPROUVE", approuveParId: user.id },
    });
    await poserCodesConge(d.employeeId, new Date(d.dateDebut), new Date(d.dateFin), d.type);
    await journaliser(prisma, {
      entite: "LeaveRequest",
      entiteId: id,
      champ: "statut",
      nouvelleValeur: "APPROUVE",
      userId: user.id,
    });
    await supprimerNotificationsPour(id);
    n++;
  }
  revaliderConges();
  return n;
}

/** ACTION GROUPÉE : refuse plusieurs demandes en attente d'un coup. */
export async function refuserCongesEnLot(ids: string[]): Promise<number> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  let n = 0;
  for (const id of ids) {
    const d = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!d || d.statut !== "EN_ATTENTE") continue;
    await prisma.leaveRequest.update({
      where: { id },
      data: { statut: "REFUSE", approuveParId: user.id },
    });
    await journaliser(prisma, {
      entite: "LeaveRequest",
      entiteId: id,
      champ: "statut",
      nouvelleValeur: "REFUSE",
      userId: user.id,
    });
    await supprimerNotificationsPour(id);
    n++;
  }
  revaliderConges();
  return n;
}

/** Supprime toutes les demandes de congé (journal complet). Action destructive réservée à l'Admin. */
export async function reinitialiserConges() {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const nb = await prisma.leaveRequest.count();
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.deleteMany({});
    await journaliser(tx, {
      entite: "LeaveRequest",
      entiteId: "*",
      champ: "suppression_totale",
      ancienneValeur: `${nb} demande(s) supprimée(s)`,
      userId: user.id,
    });
  });

  revaliderConges();
}
